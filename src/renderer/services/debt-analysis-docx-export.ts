import { strToU8, zipSync } from 'fflate';
import type { CreditReport } from '../types/credit-report';
import {
  buildDebtAnalysisReport,
  type DebtAnalysisReport,
  type PaymentReductionPlan,
} from './debt-analysis-report';
import type { LlmDebtAnalysis } from './debt-analysis-llm-service';
import type { OcrDiagnosticsReport, OcrReviewState } from '../types/ocr-diagnostics';

type DocxFiles = Record<string, Uint8Array>;
type Align = 'left' | 'center' | 'right';
type ParagraphStyle = 'Title' | 'Heading1' | 'Normal';

interface ParagraphOptions {
  style?: ParagraphStyle;
  align?: Align;
  bold?: boolean;
  size?: number;
}

interface TableCell {
  text: string;
  align?: Align;
  bold?: boolean;
  fill?: string;
  width?: number;
}

type TableCellInput = string | TableCell;

export const DEBT_ANALYSIS_DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const TABLE_WIDTH = 9600;
const TARGET_INSTALLMENT_BANKS = '广发银行、招商银行、民生银行、广州银行、平安银行、光大银行、华夏银行';

const PLAN_LABELS: Record<string, string> = {
  'normal-optimization': '不影响征信方案',
  'mild-negotiation': '减轻影响征信方案',
  'term-extension': '延长还款方案',
  'high-risk-resolution': '全案定制方案',
};

const PLAN_ADVANTAGES: Record<string, string> = {
  'normal-optimization':
    '优势：1. 征信零损伤，不逾期、不上负面记录、不新增不良信息，不影响后续房贷、车贷、信用卡及其他贷款办理。优势：2. 还款压力直接降低，快速缓解每月资金压力，避免以贷养贷，稳住现金流。劣势：无',
  'mild-negotiation':
    '优势：缓解当前压力，提前递交书面情况，告知银行未能按时还款原因，争取机会。劣势：还款期间无法再申请新贷款，征信会显示关注/止付/展期/纾困',
  'term-extension':
    '优势：1. 停止利息和违约金滚动，债务不再越还越多，避免以贷养贷。优势：2. 可分最长60期还款，大幅降低每月月供压力。优势：3. 避免催收、起诉、执行，影响家人。优势：4. 有明确还款计划，能逐步结清债务，翻身上岸。劣势：还款期间无法再申请新贷款，征信会显示逾期',
  'high-risk-resolution':
    '优势：1. 不用再为债务发愁。优势：2. 可安心工作，专心赚钱。优势：3. 90%债务会转卖三方，折扣结清所有债务，根据经验90%情况下最高4折左右可结清。劣势：1. 征信结清时恢复。劣势：2. 10%的概率可能会被起诉。',
};

export function exportDebtAnalysisReportToDocx(
  report: CreditReport,
  fileName?: string,
  aiAnalysis?: LlmDebtAnalysis,
  reviewState?: OcrReviewState,
  diagnostics?: OcrDiagnosticsReport,
): void {
  const blob = buildDebtAnalysisDocxBlob(report, aiAnalysis, reviewState, diagnostics);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = ensureDocxExtension(fileName ?? buildDefaultFileName(report));
  link.click();
  URL.revokeObjectURL(url);
}

export function buildDebtAnalysisDocxFileName(report: CreditReport): string {
  return buildDefaultFileName(report);
}

export function buildDebtAnalysisDocxBytes(
  report: CreditReport,
  aiAnalysis?: LlmDebtAnalysis,
  reviewState?: OcrReviewState,
  diagnostics?: OcrDiagnosticsReport,
): Uint8Array {
  return zipSync(buildDebtAnalysisDocxFiles(report, aiAnalysis, reviewState, diagnostics), { level: 6 });
}

export function buildDebtAnalysisDocxBlob(
  report: CreditReport,
  aiAnalysis?: LlmDebtAnalysis,
  reviewState?: OcrReviewState,
  diagnostics?: OcrDiagnosticsReport,
): Blob {
  const bytes = buildDebtAnalysisDocxBytes(report, aiAnalysis, reviewState, diagnostics);
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Blob([arrayBuffer], {
    type: DEBT_ANALYSIS_DOCX_MIME_TYPE,
  });
}

export function buildDebtAnalysisDocxBase64(
  report: CreditReport,
  aiAnalysis?: LlmDebtAnalysis,
  reviewState?: OcrReviewState,
  diagnostics?: OcrDiagnosticsReport,
): string {
  return uint8ArrayToBase64(buildDebtAnalysisDocxBytes(report, aiAnalysis, reviewState, diagnostics));
}

export function buildDebtAnalysisDocxFiles(
  report: CreditReport,
  aiAnalysis?: LlmDebtAnalysis,
  _reviewState?: OcrReviewState,
  _diagnostics?: OcrDiagnosticsReport,
): DocxFiles {
  const analysis = buildDebtAnalysisReport(report);
  return {
    '[Content_Types].xml': strToU8(buildContentTypesXml()),
    '_rels/.rels': strToU8(buildRootRelsXml()),
    'docProps/core.xml': strToU8(buildCorePropsXml(analysis)),
    'docProps/app.xml': strToU8(buildAppPropsXml()),
    'word/document.xml': strToU8(buildDebtAnalysisDocumentXml(analysis, aiAnalysis)),
    'word/styles.xml': strToU8(buildStylesXml()),
    'word/_rels/document.xml.rels': strToU8(buildDocumentRelsXml()),
  };
}

export function buildDebtAnalysisDocumentXml(analysis: DebtAnalysisReport, aiAnalysis?: LlmDebtAnalysis): string {
  const body = [
    paragraph(buildReportTitle(analysis), { style: 'Title', align: 'center' }),
    buildDeclarationTable(),
    paragraph('1. 债务清单明细', { style: 'Heading1' }),
    paragraph(`(1) 债务总额：${formatYuan(analysis.debtTotal)}（抓取征信报告中所有余额总和）`),
    paragraph(`(2) 债务笔数：${analysis.debtCount}笔（所有账户状态显示“正常”且有余额的账户数量）`),
    paragraph(`(3) 贷款余额：${formatYuan(analysis.totalLoanBalance)}（抓取所有在用贷款的“余额”总和）`),
    paragraph(
      `(4) 信用卡已用：${formatYuan(analysis.totalCardUsed)}（抓取所有在用信用卡的“已用额度”总和，${buildCardUsedNote(analysis.totalCardUsed)}）`,
    ),
    paragraph('2. 符合条件的信用卡分期方案', { style: 'Heading1' }),
    paragraph(buildInstallmentCardText(analysis, aiAnalysis)),
    paragraph('3. 月供方案对比', { style: 'Heading1' }),
    paragraph(
      `原月供计算：根据征信报告中所有账户本月应还款总和计算，原月供总额为${formatYuan(analysis.originalMonthlyPayment)}。`,
    ),
    buildPlanComparisonTable(analysis.plans, aiAnalysis),
    paragraph('方案说明与建议', { style: 'Heading1' }),
    paragraph(
      '上述为您出具的专属解决方案，具体执行细节建议当面沟通确认。操作全程遵循相关政策要求，次月即可实现还款金额下调，多出现金流、减轻生活负担，且不影响个人征信记录。',
    ),
    paragraph(`报告生成时间：${formatChineseDate(analysis.reportTime || analysis.generatedAt)}`),
    sectionProperties(),
  ].join('');

  return xmlDeclaration(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}</w:body>
</w:document>`);
}

function buildReportTitle(analysis: DebtAnalysisReport): string {
  const name = analysis.customerName.trim() || '客户';
  return `${name}-降低月供分析简版报告`;
}

function buildDeclarationTable(): string {
  return table([
    [
      {
        text: '声明：本报告仅为合法降低月供规划参考，所有方案均符合现行法律法规及监管政策，无任何教唆逃废债内容。',
        fill: 'EAF2FF',
        bold: true,
      },
    ],
  ], [TABLE_WIDTH]);
}

function buildCardUsedNote(totalCardUsed: number): string {
  if (Math.round(totalCardUsed) <= 0) return '当前所有信用卡已用额度为0';
  return `当前信用卡已用额度为${formatYuan(totalCardUsed)}`;
}

function buildInstallmentCardText(analysis: DebtAnalysisReport, aiAnalysis?: LlmDebtAnalysis): string {
  const aiText = normalizeInlineText(aiAnalysis?.installmentCardAnalysis ?? '');
  const suffix = aiText ? ` ${ensureSentence(aiText)}` : '';

  if (analysis.installmentCards.length === 0) {
    return `经筛选，您当前持有的信用卡中无符合条件的可分期银行（${TARGET_INSTALLMENT_BANKS}）信用卡账户。${suffix}`;
  }

  const cards = analysis.installmentCards.map((card) => card.org).join('、');
  return `经筛选，您当前持有的信用卡中符合条件的可分期银行账户为：${cards}。${suffix}`;
}

function buildPlanComparisonTable(plans: PaymentReductionPlan[], aiAnalysis?: LlmDebtAnalysis): string {
  const planOrder = ['normal-optimization', 'mild-negotiation', 'term-extension', 'high-risk-resolution'];
  const orderedPlans = planOrder
    .map((key) => plans.find((plan) => plan.key === key))
    .filter((plan): plan is PaymentReductionPlan => Boolean(plan));

  const rows: TableCellInput[][] = [
    [
      { text: '方案类型', bold: true, align: 'center', fill: 'D9EAF7' },
      { text: '原月供（元）', bold: true, align: 'center', fill: 'D9EAF7' },
      { text: '降低后月供（元）', bold: true, align: 'center', fill: 'D9EAF7' },
      { text: '每月多出现金流（元）', bold: true, align: 'center', fill: 'D9EAF7' },
      { text: '优劣势', bold: true, align: 'center', fill: 'D9EAF7' },
    ],
    ...orderedPlans.map<TableCellInput[]>((plan) => [
      PLAN_LABELS[plan.key] ?? plan.name,
      { text: formatTableNumber(plan.originalMonthlyPayment), align: 'center' },
      { text: formatTableNumber(plan.targetMonthlyPayment), align: 'center' },
      { text: formatTableNumber(plan.releasedCashFlow), align: 'center' },
      buildPlanAnalysisText(plan, aiAnalysis),
    ]),
  ];

  return table(rows, [1500, 1400, 1700, 1900, 3100]);
}

function buildPlanAnalysisText(plan: PaymentReductionPlan, aiAnalysis?: LlmDebtAnalysis): string {
  const comment = aiAnalysis?.planComments.find((item) => (
    item.planKey === plan.key
    || item.planName === plan.name
    || item.planName === PLAN_LABELS[plan.key]
  ));

  if (!comment) return PLAN_ADVANTAGES[plan.key] ?? buildFallbackPlanNote(plan);

  const parts = [
    formatLabeledSentence('优势与适用性', comment.suitability),
    formatLabeledList('执行前提', comment.prerequisites),
    formatLabeledList('风险与劣势', comment.cautions),
  ].filter(Boolean);

  return parts.length > 0 ? parts.join('') : PLAN_ADVANTAGES[plan.key] ?? buildFallbackPlanNote(plan);
}

function buildFallbackPlanNote(plan: PaymentReductionPlan): string {
  const advantages = plan.advantages.length ? plan.advantages.join('；') : '需结合合同与账单确认';
  const risks = plan.risks.length ? plan.risks.join('；') : '需执行前复核';
  return `优势：${advantages}。劣势：${risks}`;
}

function formatLabeledSentence(label: string, value: string): string {
  const text = normalizeInlineText(value);
  return text ? `${label}：${ensureSentence(text)}` : '';
}

function formatLabeledList(label: string, values: string[]): string {
  const text = values.map(normalizeInlineText).filter(Boolean).join('；');
  return text ? `${label}：${ensureSentence(text)}` : '';
}

function normalizeInlineText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function ensureSentence(value: string): string {
  return /[。！？.!?]$/.test(value) ? value : `${value}。`;
}

function table(rows: TableCellInput[][], widths: number[]): string {
  return `<w:tbl>
    <w:tblPr>
      <w:tblW w:w="${TABLE_WIDTH}" w:type="dxa"/>
      <w:tblBorders>
        <w:top w:val="single" w:sz="8" w:space="0" w:color="7F7F7F"/>
        <w:left w:val="single" w:sz="8" w:space="0" w:color="7F7F7F"/>
        <w:bottom w:val="single" w:sz="8" w:space="0" w:color="7F7F7F"/>
        <w:right w:val="single" w:sz="8" w:space="0" w:color="7F7F7F"/>
        <w:insideH w:val="single" w:sz="6" w:space="0" w:color="BFBFBF"/>
        <w:insideV w:val="single" w:sz="6" w:space="0" w:color="BFBFBF"/>
      </w:tblBorders>
      <w:tblCellMar>
        <w:top w:w="120" w:type="dxa"/>
        <w:left w:w="120" w:type="dxa"/>
        <w:bottom w:w="120" w:type="dxa"/>
        <w:right w:w="120" w:type="dxa"/>
      </w:tblCellMar>
    </w:tblPr>
    ${rows.map((row) => tableRow(row, widths)).join('')}
  </w:tbl>`;
}

function tableRow(row: TableCellInput[], widths: number[]): string {
  return `<w:tr>${row.map((cell, index) => tableCell(cell, widths[index] ?? widths[widths.length - 1] ?? TABLE_WIDTH)).join('')}</w:tr>`;
}

function tableCell(input: TableCellInput, width: number): string {
  const cell: TableCell = typeof input === 'string' ? { text: input } : input;
  const fill = cell.fill ? `<w:shd w:fill="${cell.fill}"/>` : '';
  return `<w:tc>
    <w:tcPr>
      <w:tcW w:w="${cell.width ?? width}" w:type="dxa"/>
      <w:vAlign w:val="center"/>
      ${fill}
    </w:tcPr>
    ${paragraph(cell.text, { align: cell.align, bold: cell.bold, size: 20 })}
  </w:tc>`;
}

function paragraph(text: string, options: ParagraphOptions = {}): string {
  const style = options.style ? `<w:pStyle w:val="${options.style}"/>` : '';
  const align = options.align ? `<w:jc w:val="${options.align}"/>` : '';
  const spacing = options.style === 'Title'
    ? '<w:spacing w:before="120" w:after="260"/>'
    : options.style === 'Heading1'
      ? '<w:spacing w:before="220" w:after="120"/>'
      : '<w:spacing w:before="0" w:after="80" w:line="360" w:lineRule="auto"/>';
  const runProps = runProperties({ bold: options.bold, size: options.size });

  return `<w:p>
    <w:pPr>${style}${align}${spacing}</w:pPr>
    <w:r>${runProps}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>
  </w:p>`;
}

function runProperties(options: { bold?: boolean; size?: number } = {}): string {
  const bold = options.bold ? '<w:b/>' : '';
  const size = options.size ? `<w:sz w:val="${options.size}"/><w:szCs w:val="${options.size}"/>` : '';
  return `<w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/>${bold}${size}</w:rPr>`;
}

function sectionProperties(): string {
  return `<w:sectPr>
    <w:pgSz w:w="11906" w:h="16838"/>
    <w:pgMar w:top="1100" w:right="950" w:bottom="950" w:left="950" w:header="708" w:footer="708" w:gutter="0"/>
  </w:sectPr>`;
}

function buildContentTypesXml(): string {
  return xmlDeclaration(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`);
}

function buildRootRelsXml(): string {
  return xmlDeclaration(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`);
}

function buildDocumentRelsXml(): string {
  return xmlDeclaration(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
}

function buildCorePropsXml(analysis: DebtAnalysisReport): string {
  const now = new Date().toISOString();
  const title = buildReportTitle(analysis);
  return xmlDeclaration(`<cp:coreProperties
  xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:dcmitype="http://purl.org/dc/dcmitype/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(title)}</dc:title>
  <dc:creator>LoanIntelligence Parser</dc:creator>
  <cp:lastModifiedBy>LoanIntelligence Parser</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`);
}

function buildAppPropsXml(): string {
  return xmlDeclaration(`<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
  xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>LoanIntelligence Parser</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <HeadingPairs>
    <vt:vector size="2" baseType="variant">
      <vt:variant><vt:lpstr>Title</vt:lpstr></vt:variant>
      <vt:variant><vt:i4>1</vt:i4></vt:variant>
    </vt:vector>
  </HeadingPairs>
  <TitlesOfParts>
    <vt:vector size="1" baseType="lpstr">
      <vt:lpstr>降低月供分析简版报告</vt:lpstr>
    </vt:vector>
  </TitlesOfParts>
  <Company></Company>
  <LinksUpToDate>false</LinksUpToDate>
  <SharedDoc>false</SharedDoc>
  <HyperlinksChanged>false</HyperlinksChanged>
  <AppVersion>16.0000</AppVersion>
</Properties>`);
}

function buildStylesXml(): string {
  return xmlDeclaration(`<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/>
        <w:sz w:val="21"/>
        <w:szCs w:val="21"/>
        <w:color w:val="111827"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:after="80" w:line="360" w:lineRule="auto"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:rPr>
      <w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/>
      <w:b/>
      <w:sz w:val="34"/>
      <w:szCs w:val="34"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:rPr>
      <w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/>
      <w:b/>
      <w:sz w:val="24"/>
      <w:szCs w:val="24"/>
    </w:rPr>
  </w:style>
</w:styles>`);
}

function buildDefaultFileName(report: CreditReport): string {
  const analysis = buildDebtAnalysisReport(report);
  const name = sanitizeFileName(analysis.customerName || '客户');
  return `${name}-降低月供分析简版报告.docx`;
}

function ensureDocxExtension(fileName: string): string {
  return fileName.toLowerCase().endsWith('.docx') ? fileName : `${fileName}.docx`;
}

function sanitizeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '').trim() || '客户';
}

function formatYuan(value: number): string {
  return `${formatTableNumber(value)}元`;
}

function formatTableNumber(value: number): string {
  return Math.round(value || 0).toLocaleString('zh-CN');
}

function formatChineseDate(value: string): string {
  const normalized = value.trim();
  const match = normalized.match(/(\d{4})[.\-/年](\d{1,2})[.\-/月](\d{1,2})/);
  if (match) {
    const [, year, month, day] = match;
    return `${year}年${month.padStart(2, '0')}月${day.padStart(2, '0')}日`;
  }

  const date = new Date(normalized);
  if (!Number.isNaN(date.getTime())) {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}年${month}月${day}日`;
  }

  return normalized || formatChineseDate(new Date().toISOString());
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function xmlDeclaration(content: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${content}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
