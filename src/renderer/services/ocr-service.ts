import { DocParserResult } from '../../shared/doc-parser-types';
import { OcrResult } from '../types/client-profile';
import { parseCreditReport } from '../parser';
import { MIN_TEXT_LENGTH, isImageFile } from '../config/ocr-config';
import { parseDocument } from './textin-document-parser';
import { correctOcrText, correctDocResult } from '../parser/ocr-corrector';
import { reorderPages, reorderDocPages } from '../parser/page-reorder';
import { evaluateOcrQuality } from '../parser/ocr-quality';
import { debugLog } from '../utils/debug-log';
import { mergeDocParserResults } from './doc-parser-merge';
import { preprocessImage, type PreprocessOptions } from './image-preprocess';
import { evaluateImageQuality } from './image-quality';
import { validateCreditReportData } from './credit-report-validation';
import { normalizeCreditReportInstitutions } from './institution-normalizer';
import { fuseDocParserCandidateTables } from './doc-parser-candidate-fusion';
import { pdfToImages } from './pdf-to-image';
import type { CreditReport } from '../types/credit-report';
import type {
  ImageQualityDiagnostic,
  InstitutionCorrectionDiagnostic,
  OcrCandidateDiagnostic,
  OcrDiagnosticsReport,
} from '../types/ocr-diagnostics';
import * as pdfjsLib from 'pdfjs-dist';

const PDF_TEXT_MIN_REPORT_SIGNALS = 3;
const CREDIT_REPORT_TEXT_SIGNALS = [
  '\u4e2a\u4eba\u4fe1\u7528\u62a5\u544a',
  '\u62a5\u544a\u7f16\u53f7',
  '\u62a5\u544a\u65f6\u95f4',
  '\u672c\u4eba\u7248',
  '\u4e2a\u4eba\u57fa\u672c\u4fe1\u606f',
  '\u4fe1\u606f\u6982\u8981',
  '\u4fe1\u8d37\u4ea4\u6613\u4fe1\u606f\u660e\u7ec6',
  '\u67e5\u8be2\u8bb0\u5f55',
  '\u7ba1\u7406\u673a\u6784',
  '\u53d1\u5361\u673a\u6784',
  '\u8d26\u6237',
];
const CREDIT_DETAIL_TEXT_SIGNALS = [
  '\u4fe1\u8d37\u4ea4\u6613\u4fe1\u606f\u660e\u7ec6',
  '\u975e\u5faa\u73af\u8d37\u8d26\u6237',
  '\u5faa\u73af\u8d37\u8d26\u6237',
  '\u8d37\u8bb0\u5361\u8d26\u6237',
  '\u76f8\u5173\u8fd8\u6b3e\u8d23\u4efb',
  '\u6388\u4fe1\u534f\u8bae',
];

interface OcrDocumentResult {
  docResult: DocParserResult;
  candidates: OcrCandidateDiagnostic[];
}

/**
 * 从电子版 PDF 直接提取文本层
 * 准确率远高于 OCR，优先使用
 */
async function extractTextFromPdf(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages: string[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ');
    pages.push(text);
  }

  // 页面重排：根据页脚逻辑页码修正乱序
  const ordered = reorderPages(pages);
  return ordered.join('\n');
}

/** 将 File 转为 base64 字符串（不含 data: 前缀） */
async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * 从文档解析结果中提取全文文本
 * 表格区域提取为纯文本行（每个唯一单元格值一行），保持与旧 OCR 行模式兼容
 */
function extractTextFromDocParser(result: DocParserResult): string {
  const pageTexts: string[] = [];

  for (const page of result.pages) {
    const parts: string[] = [];
    for (const layout of page.layouts) {
      if (layout.type === 'table') {
        const table = page.tables.find((t) => t.layout_id === layout.layout_id);
        if (table?.markdown) {
          parts.push(markdownTableToPlainLines(table.markdown));
        }
      } else if (layout.text) {
        // layout.text 也可能内嵌 Markdown 表格，需要检测并转换
        parts.push(convertTextWithTables(layout.text));
      }
    }
    pageTexts.push(parts.join('\n'));
  }

  return pageTexts.join('\n');
}

/** 检测文本中是否包含 Markdown 表格行，有则转为纯文本 */
function convertTextWithTables(text: string): string {
  if (!text.includes('|')) return text;

  const lines = text.split('\n');
  const result: string[] = [];
  let tableBlock: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      tableBlock.push(line);
    } else {
      if (tableBlock.length > 0) {
        result.push(markdownTableToPlainLines(tableBlock.join('\n')));
        tableBlock = [];
      }
      if (trimmed) result.push(trimmed);
    }
  }
  if (tableBlock.length > 0) {
    result.push(markdownTableToPlainLines(tableBlock.join('\n')));
  }

  return result.join('\n');
}

/** 将 Markdown 表格转为纯文本行：提取每行每列的唯一值，每个值一行 */
function markdownTableToPlainLines(markdown: string): string {
  const lines = markdown.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || /^\|[\s\-:|]+\|$/.test(trimmed)) continue;

    const cells = trimmed.slice(1, -1).split('|').map((c) => c.trim());
    // 去重：征信报告表格常有合并单元格导致同一值重复多列
    const seen = new Set<string>();
    for (const cell of cells) {
      if (!cell || seen.has(cell)) continue;
      seen.add(cell);
      result.push(cell);
    }
  }

  return result.join('\n');
}

function buildDiagnostics(
  report: import('../types/credit-report').CreditReport,
  images: ImageQualityDiagnostic[] = [],
  candidates: OcrCandidateDiagnostic[] = [],
  institutionCorrections: InstitutionCorrectionDiagnostic[] = [],
): OcrDiagnosticsReport {
  return {
    images,
    candidates,
    institutionCorrections,
    validation: validateCreditReportData(report),
  };
}

function logQuality(quality: ReturnType<typeof evaluateOcrQuality> | undefined): void {
  if (!quality) return;
  debugLog('[OCRQuality]', JSON.stringify({
    profile: quality.profile,
    score: quality.score,
    pages: quality.pages,
    tables: quality.tables.count,
    anchors: `${quality.anchors.found}/${quality.anchors.required}`,
    issues: quality.issues,
  }));
}

function shouldFallbackPdfTextLayer(
  fullText: string,
  report: CreditReport,
  validation: ReturnType<typeof validateCreditReportData>,
): boolean {
  const normalized = normalizePdfTextSignal(fullText);
  const signalCount = countPdfTextSignals(normalized, CREDIT_REPORT_TEXT_SIGNALS);
  const hasCreditDetailSignal = CREDIT_DETAIL_TEXT_SIGNALS.some((signal) => normalized.includes(signal));
  const detailCount = countReportDetailItems(report);

  if (signalCount === 0) return true;
  if (signalCount < PDF_TEXT_MIN_REPORT_SIGNALS && !hasParsedReportData(report)) return true;
  if (hasCreditDetailSignal && detailCount === 0) return true;
  if (validation.summary.critical > 0 && signalCount < PDF_TEXT_MIN_REPORT_SIGNALS + 1) return true;
  return validation.requiresReview && detailCount === 0 && !hasParsedReportData(report);
}

function countPdfTextSignals(text: string, signals: string[]): number {
  return signals.reduce((count, signal) => count + (text.includes(signal) ? 1 : 0), 0);
}

function hasParsedReportData(report: CreditReport): boolean {
  const headerFields = [
    report.header.name,
    report.header.reportNo,
    report.header.reportTime,
    report.header.certNo,
  ].filter(Boolean).length;
  return headerFields >= 2 ||
    countReportDetailItems(report) > 0 ||
    countQueryRecords(report) > 0 ||
    hasDerivedAccountCounts(report);
}

function countReportDetailItems(report: CreditReport): number {
  return report.creditDetail.nonRevolvingLoans.length +
    report.creditDetail.revolvingLoansType1.length +
    report.creditDetail.revolvingLoansType2.length +
    report.creditDetail.creditCards.length +
    report.creditDetail.quasiCreditCards.length +
    report.repayResponsibilities.length +
    report.creditAgreements.length +
    report.accountBriefs.length;
}

function countQueryRecords(report: CreditReport): number {
  return report.queryRecord.orgQueries.length + report.queryRecord.selfQueries.length;
}

function hasDerivedAccountCounts(report: CreditReport): boolean {
  return Object.values(report.accountDerived).some((summary) => (summary?.accountCount ?? 0) > 0);
}

function normalizePdfTextSignal(text: string): string {
  return text.replace(/[\s\u3000]/g, '');
}

/**
 * 解析征信报告（自动选择路径）
 * 路径 A：电子版 PDF → 文本直提 → 解析引擎
 * 路径 B：扫描件 PDF/图片 → TextIn 文档解析 API → 结构化数据 → 解析引擎
 */
export async function analyzeCreditReport(file: File): Promise<OcrResult> {
  return analyzeSingleCreditReport(file);
}

export async function analyzeCreditReportFiles(files: File[]): Promise<OcrResult> {
  const validFiles = files.filter(Boolean);
  if (validFiles.length === 0) {
    throw new Error('No files selected');
  }

  if (validFiles.length === 1) {
    return analyzeSingleCreditReport(validFiles[0]);
  }

  if (!validFiles.every(isImageFile)) {
    throw new Error('Multiple-file OCR only supports image files');
  }

  return analyzeImageSetCreditReport(validFiles);
}

async function analyzeSingleCreditReport(file: File): Promise<OcrResult> {
  const image = isImageFile(file);
  let fullText = '';
  let docResult: DocParserResult | undefined;
  const imageDiagnostics: ImageQualityDiagnostic[] = [];
  let candidateDiagnostics: OcrCandidateDiagnostic[] = [];

  if (image) {
    // 图片 → 直接走 OCR，无 pdfjs 文本层
    debugLog('[DocParser] image file detected, using document parser...');
    const imageQuality = await evaluateImageQuality(file);
    imageDiagnostics.push(imageQuality);
    const result = await analyzeImageViaOcrCandidates(file, imageQuality);
    docResult = result.docResult;
    candidateDiagnostics = result.candidates;
    fullText = extractTextFromDocParser(docResult);
    fullText = correctOcrText(fullText);
  } else {
    // PDF → 先尝试文本直提，不足则走 OCR
    const usePdfOcrFallback = async (reason: string, err?: unknown) => {
      debugLog(`[DocParser] ${reason}, using document parser...`, err ?? '');
      const result = await analyzeScannedPdfViaOcrCandidates(file);
      docResult = result.docResult;
      candidateDiagnostics = result.candidates;
      fullText = extractTextFromDocParser(docResult);
      fullText = correctOcrText(fullText);
    };

    try {
      fullText = await extractTextFromPdf(file);
    } catch (err) {
      await usePdfOcrFallback('pdf text extraction failed', err);
    }

    if (!docResult) {
      const isScanned = fullText.trim().length < MIN_TEXT_LENGTH;

      if (isScanned) {
        await usePdfOcrFallback('scanned or empty pdf text layer detected');
      } else {
        const textParsed = parseCreditReport(fullText);
        const { report: textReport } = normalizeCreditReportInstitutions(textParsed.report);
        const validation = validateCreditReportData(textReport);
        if (shouldFallbackPdfTextLayer(fullText, textReport, validation)) {
          await usePdfOcrFallback('weak pdf text layer detected');
        }
      }
    }
  }

  const quality = docResult ? evaluateOcrQuality(docResult) : undefined;
  logQuality(quality);

  const { profile, confidence, report: parsedReport } = parseCreditReport(fullText, undefined, docResult);
  const { report, corrections } = normalizeCreditReportInstitutions(parsedReport);
  return {
    profile,
    confidence,
    report,
    quality,
    diagnostics: buildDiagnostics(report, imageDiagnostics, candidateDiagnostics, corrections),
  };
}

/** 通过 OCR API 解析文件，返回结构化结果 */
async function analyzeImageSetCreditReport(files: File[]): Promise<OcrResult> {
  debugLog('[DocParser] multi-image document detected, pages:', files.length);
  const imageDiagnostics: ImageQualityDiagnostic[] = [];
  for (const file of files) {
    imageDiagnostics.push(await evaluateImageQuality(file));
  }
  const imageResult = await analyzeMultiImageViaOcr(files, imageDiagnostics);
  const { docResult } = imageResult;
  let fullText = extractTextFromDocParser(docResult);
  fullText = correctOcrText(fullText);

  const quality = evaluateOcrQuality(docResult);
  logQuality(quality);

  const { profile, confidence, report: parsedReport } = parseCreditReport(fullText, undefined, docResult);
  const { report, corrections } = normalizeCreditReportInstitutions(parsedReport);
  return {
    profile,
    confidence,
    report,
    quality,
    diagnostics: buildDiagnostics(report, imageDiagnostics, imageResult.candidates, corrections),
  };
}

async function analyzeViaOcr(file: File): Promise<DocParserResult> {
  return normalizeOcrDocResult(await parseViaOcr(file));
}

async function analyzeImageViaOcrCandidates(
  file: File,
  imageQuality?: ImageQualityDiagnostic,
): Promise<OcrDocumentResult> {
  const originalBase64 = await fileToBase64(file);
  return analyzeBase64ViaOcrCandidates(file.name, originalBase64, imageQuality);
}

async function analyzeBase64ViaOcrCandidates(
  fileName: string,
  originalBase64: string,
  imageQuality?: ImageQualityDiagnostic,
): Promise<OcrDocumentResult> {
  const candidates: Array<{ variant: string; base64: string }> = [
    { variant: '原图', base64: originalBase64 },
  ];

  const original = await parseBase64Candidate(fileName, candidates[0]);
  let parsed = [original];

  if (shouldTryEnhancedCandidates(original.quality.score, imageQuality)) {
    const enhanced = await buildPreprocessCandidates(originalBase64);
    for (const candidate of enhanced) {
      try {
        parsed.push(await parseBase64Candidate(fileName, candidate));
      } catch (err) {
        debugLog(`[DocParser] OCR candidate skipped: ${fileName} ${candidate.variant}`, err);
      }
    }
  }

  const best = parsed.reduce((winner, item) =>
    rankCandidate(item.quality) > rankCandidate(winner.quality) ? item : winner,
  );

  const diagnostics = parsed.map((item) => ({
    fileName,
    variant: item.variant,
    selected: item === best,
    score: item.quality.score,
    tables: item.quality.tables.count,
    anchorsFound: item.quality.anchors.found,
    issues: item.quality.issues,
  }));

  const fusedDocResult = fuseDocParserCandidateTables(
    best.docResult,
    parsed.map((item) => item.docResult),
  );

  return {
    docResult: fusedDocResult,
    candidates: diagnostics,
  };
}

async function analyzeScannedPdfViaOcrCandidates(file: File): Promise<OcrDocumentResult> {
  const original = await analyzeViaOcr(file);
  const originalQuality = evaluateOcrQuality(original);
  const originalDiagnostic: OcrCandidateDiagnostic = {
    fileName: file.name,
    variant: '原始PDF',
    selected: true,
    score: originalQuality.score,
    tables: originalQuality.tables.count,
    anchorsFound: originalQuality.anchors.found,
    issues: originalQuality.issues,
  };

  if (!shouldTryEnhancedCandidates(originalQuality.score)) {
    return { docResult: original, candidates: [originalDiagnostic] };
  }

  try {
    const pageImages = await pdfToImages(file);
    const pageResults: DocParserResult[] = [];
    const pageCandidates: OcrCandidateDiagnostic[] = [];
    for (let i = 0; i < pageImages.length; i++) {
      const result = await analyzeBase64ViaOcrCandidates(`${file.name}#第${i + 1}页`, pageImages[i]);
      pageResults.push(result.docResult);
      pageCandidates.push(...result.candidates);
    }

    const rendered = normalizeOcrDocResult(mergeDocParserResults(pageResults, `${file.name}#逐页渲染`));
    const renderedQuality = evaluateOcrQuality(rendered);
    const renderedDiagnostic: OcrCandidateDiagnostic = {
      fileName: file.name,
      variant: 'PDF逐页渲染',
      selected: false,
      score: renderedQuality.score,
      tables: renderedQuality.tables.count,
      anchorsFound: renderedQuality.anchors.found,
      issues: renderedQuality.issues,
    };

    const useRendered = rankCandidate(renderedQuality) > rankCandidate(originalQuality);
    originalDiagnostic.selected = !useRendered;
    renderedDiagnostic.selected = useRendered;

    return {
      docResult: useRendered ? rendered : original,
      candidates: [originalDiagnostic, renderedDiagnostic, ...pageCandidates],
    };
  } catch (err) {
    debugLog('[DocParser] scanned pdf rendered candidates failed, using original pdf OCR', err);
    return { docResult: original, candidates: [originalDiagnostic] };
  }
}

async function analyzeMultiImageViaOcr(
  files: File[],
  imageDiagnostics: ImageQualityDiagnostic[],
): Promise<OcrDocumentResult> {
  const results: DocParserResult[] = [];
  const candidates: OcrCandidateDiagnostic[] = [];
  for (let i = 0; i < files.length; i++) {
    debugLog(`[DocParser] OCR image ${i + 1}/${files.length}:`, files[i].name);
    const result = await analyzeImageViaOcrCandidates(files[i], imageDiagnostics[i]);
    results.push(result.docResult);
    candidates.push(...result.candidates);
  }

  return {
    docResult: normalizeOcrDocResult(mergeDocParserResults(results, buildMultiImageFileName(files))),
    candidates,
  };
}

async function parseBase64Candidate(
  fileName: string,
  candidate: { variant: string; base64: string },
): Promise<{ variant: string; docResult: DocParserResult; quality: ReturnType<typeof evaluateOcrQuality> }> {
  const docResult = normalizeOcrDocResult(
    await parseDocument(candidate.base64, `${fileName}#${candidate.variant}`),
  );
  return {
    variant: candidate.variant,
    docResult,
    quality: evaluateOcrQuality(docResult),
  };
}

async function buildPreprocessCandidates(
  base64: string,
): Promise<Array<{ variant: string; base64: string }>> {
  const variants: Array<{ variant: string; options: Partial<PreprocessOptions> }> = [
    { variant: '增强对比', options: { contrast: 1.35, binaryThreshold: 175, denoise: false } },
    { variant: '轻二值化', options: { contrast: 1.55, binaryThreshold: 155, denoise: true } },
    { variant: '自适应二值化', options: { contrast: 1.45, adaptiveThreshold: true, denoise: true } },
  ];
  const results: Array<{ variant: string; base64: string }> = [];

  for (const variant of variants) {
    try {
      results.push({
        variant: variant.variant,
        base64: await preprocessImage(base64, variant.options),
      });
    } catch (err) {
      debugLog(`[ImagePreprocess] ${variant.variant} failed`, err);
    }
  }

  return results;
}

function shouldTryEnhancedCandidates(
  originalScore: number,
  imageQuality?: ImageQualityDiagnostic,
): boolean {
  if (imageQuality && (imageQuality.score < 0.86 || imageQuality.issues.length > 0)) return true;
  return originalScore < 0.86;
}

function rankCandidate(quality: ReturnType<typeof evaluateOcrQuality>): number {
  return quality.score * 100
    + quality.tables.count * 1.2
    + quality.anchors.found * 0.7
    + quality.scope.recognizedModules.length * 1.5
    - quality.issues.length * 1.8;
}

async function parseViaOcr(file: File): Promise<DocParserResult> {
  const base64 = await fileToBase64(file);
  return parseDocument(base64, file.name || 'document');
}

function normalizeOcrDocResult(docResult: DocParserResult): DocParserResult {
  // 页面重排：根据页脚逻辑页码修正乱序，并更新 page_num
  docResult.pages = reorderDocPages(docResult.pages);
  docResult.pages.forEach((p, i) => { p.page_num = i; });

  correctDocResult(docResult);

  return docResult;
}

function buildMultiImageFileName(files: File[]): string {
  const first = files[0]?.name?.replace(/\.[^.]+$/, '') || 'multi-image-credit-report';
  return `${first}_等${files.length}张图片`;
}
