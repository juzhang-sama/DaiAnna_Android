import { strToU8, zipSync } from 'fflate';
import type { CreditReport } from '../types/credit-report';
import {
  buildDebtAnalysisReport,
  type DebtAnalysisReport,
  type PaymentReductionPlan,
} from './debt-analysis-report';
import type { LlmDebtAnalysis, LlmPriorityAction } from './debt-analysis-llm-service';
import {
  buildOcrReviewExportSummary,
  type OcrReviewExportSummary,
} from './ocr-review-export';
import type { OcrDiagnosticsReport, OcrReviewState } from '../types/ocr-diagnostics';

type DocxFiles = Record<string, Uint8Array>;

export const DEBT_ANALYSIS_DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function exportDebtAnalysisReportToDocx(
  report: CreditReport,
  fileName: string = buildDefaultFileName(report),
  aiAnalysis?: LlmDebtAnalysis,
  reviewState?: OcrReviewState,
  diagnostics?: OcrDiagnosticsReport,
): void {
  const blob = buildDebtAnalysisDocxBlob(report, aiAnalysis, reviewState, diagnostics);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = ensureDocxExtension(fileName);
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
  reviewState?: OcrReviewState,
  diagnostics?: OcrDiagnosticsReport,
): DocxFiles {
  const analysis = buildDebtAnalysisReport(report);
  const reviewSummary = buildOcrReviewExportSummary(report, reviewState, diagnostics?.institutionCorrections);
  return {
    '[Content_Types].xml': strToU8(buildContentTypesXml()),
    '_rels/.rels': strToU8(buildRootRelsXml()),
    'docProps/core.xml': strToU8(buildCorePropsXml(analysis)),
    'docProps/app.xml': strToU8(buildAppPropsXml()),
    'word/document.xml': strToU8(buildDebtAnalysisDocumentXml(analysis, aiAnalysis, reviewSummary)),
    'word/styles.xml': strToU8(buildStylesXml()),
    'word/_rels/document.xml.rels': strToU8(buildDocumentRelsXml()),
  };
}

export function buildDebtAnalysisDocumentXml(
  analysis: DebtAnalysisReport,
  aiAnalysis?: LlmDebtAnalysis,
  reviewSummary?: OcrReviewExportSummary,
): string {
  const body = [
    paragraph('客户降低月供分析建议书', { style: 'Title', align: 'center' }),
    paragraph(`客户姓名：${analysis.customerName || '-'}    报告时间：${analysis.reportTime || '-'}    生成时间：${formatDateTime(analysis.generatedAt)}`, { style: 'Small' }),
    paragraph('本建议书基于征信 OCR 结构化数据生成。由于 OCR、账户状态、机构政策和客户实际流水都可能存在偏差，以下结论按“方向判断 + 保守区间”使用，不把单个测算数字视为承诺结果。执行前必须核对原始征信、合同、账单和收入流水。', { style: 'Note' }),

    heading('一、结论摘要'),
    ...buildConciseConclusionBody(analysis, aiAnalysis, reviewSummary),

    heading('二、落地方案'),
    ...buildLandingPlanBody(analysis, aiAnalysis),

    heading('三、执行前核验'),
    ...buildVerificationBody(analysis, reviewSummary),

    heading('四、数据依据与风险'),
    ...buildDataAndRiskBody(analysis, aiAnalysis, reviewSummary),

    paragraph('报告生成完毕。', { style: 'Small', align: 'right' }),
    sectionProperties(),
  ].join('');

  return xmlDeclaration(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}</w:body>
</w:document>`);
}

function buildConciseConclusionBody(
  analysis: DebtAnalysisReport,
  aiAnalysis?: LlmDebtAnalysis,
  reviewSummary?: OcrReviewExportSummary,
): string[] {
  const mainPlan = pickMainPlan(analysis);
  const leadingDebt = getLeadingDebt(analysis);
  const highestPayment = getHighestPayment(analysis);
  const dataConfidence = reviewSummary && reviewSummary.pendingCount > 0
    ? `当前仍有 ${reviewSummary.pendingCount} 项字段未复核，建议先按保守口径执行。`
    : '当前数据可作为初步判断依据，但仍需用合同、账单和流水做最终确认。';

  return [
    bullet(`当前识别月供约 ${formatYuan(analysis.originalMonthlyPayment)}，目标不是追求一次性最低月供，而是先降低短期压力并保持征信连续性。`),
    leadingDebt ? bullet(`余额主要集中在${leadingDebt.label}，约 ${formatYuan(leadingDebt.balance)}，占比 ${formatRatio(leadingDebt.balanceShare)}。`) : '',
    highestPayment ? bullet(`月供压力优先看${highestPayment.label}，约 ${formatYuan(highestPayment.monthlyPayment)}，占比 ${formatRatio(highestPayment.paymentShare)}。`) : '',
    mainPlan
      ? bullet(`主方案建议采用“${mainPlan.name}”：不要按单点值承诺，建议按保守释放区间 ${formatYuanRange(mainPlan.releasedCashFlow)} 制定预算。`)
      : bullet('暂未形成可测算主方案，先补齐合同、账单和流水后再判断。'),
    bullet(dataConfidence),
    ...(aiAnalysis?.executiveSummary ? [bullet(`补充判断：${aiAnalysis.executiveSummary}`)] : []),
  ].filter(Boolean);
}

function buildLandingPlanBody(
  analysis: DebtAnalysisReport,
  aiAnalysis?: LlmDebtAnalysis,
): string[] {
  const mainPlan = pickMainPlan(analysis);
  const actions = aiAnalysis?.priorityActions.length
    ? aiAnalysis.priorityActions.slice(0, 2)
    : buildRuleBasedPriorityActions(analysis).slice(0, 3);

  return [
    mainPlan
      ? paragraph(`主推：${mainPlan.name}`, { style: 'Heading2' })
      : paragraph('主推：先补齐资料后再定方案', { style: 'Heading2' }),
    mainPlan
      ? bullet(`预算口径：测算释放 ${formatYuan(mainPlan.releasedCashFlow)}，实际执行建议按 ${formatYuanRange(mainPlan.releasedCashFlow)} 预留容错。`)
      : bullet('当前月供或余额数据不足，不建议直接给客户承诺压降金额。'),
    ...actions.map((action) => bullet(`${action.priority}. ${action.title}：${action.action}`)),
    bullet('和机构沟通时只确认五件事：能否调整、调整后月供、总成本变化、征信展示方式、是否需要补充材料。'),
    bullet('落地顺序建议：先处理月供最高且可沟通空间最大的账户，再处理信用卡账单和还款日节奏。'),
    bullet('高风险处置、重组或展期只作为备选，不作为首推；没有书面规则前，不向客户承诺结果。'),
  ];
}

function buildVerificationBody(
  analysis: DebtAnalysisReport,
  reviewSummary?: OcrReviewExportSummary,
): string[] {
  return [
    bullet('先核对原始征信：账户状态、余额、本月应还、逾期信息、信用卡已用额度。'),
    bullet('再核对机构资料：贷款合同、还款计划、信用卡账单、可分期规则、是否有提前还款或展期费用。'),
    bullet('最后核对客户现金流：近 6 个月收入流水、固定支出、现有还款日和实际可承受月供。'),
    reviewSummary
      ? bullet(`复核提醒：系统识别出需复核字段 ${reviewSummary.totalReviewable} 项，其中未复核 ${reviewSummary.pendingCount} 项。`)
      : bullet('复核提醒：当前未附加 OCR 复核摘要，建议人工抽查关键金额。'),
    bullet('如果核对后关键金额或月供偏差超过 10%，本建议书只能作为方向参考，需要重新生成方案。'),
  ];
}

function buildRuleBasedPriorityActions(analysis: DebtAnalysisReport): LlmPriorityAction[] {
  const actions: LlmPriorityAction[] = [];
  const highestPayment = getHighestPayment(analysis);

  if (analysis.metrics.overdueAccountCount > 0) {
    actions.push({
      priority: actions.length + 1,
      title: '先处理当前逾期和状态异常账户',
      reason: '逾期会显著影响后续协商空间和征信判断。',
      action: '核对逾期账户、逾期金额、是否已还清以及征信更新时间，先做止损和状态修复。',
      evidence: [`当前逾期账户数：${analysis.metrics.overdueAccountCount} 个`],
    });
  }

  if (highestPayment && highestPayment.monthlyPayment > 0) {
    actions.push({
      priority: actions.length + 1,
      title: `优先压降${highestPayment.label}月供`,
      reason: `${highestPayment.label}是当前月供压力最高的类别，优先处理更容易看到现金流改善。`,
      action: `核查${highestPayment.label}的合同利率、剩余期数、还款方式、账单日和机构调整政策。`,
      evidence: [`${highestPayment.label}月供：${formatYuan(highestPayment.monthlyPayment)}`],
    });
  }

  if ((analysis.metrics.nonMortgageDebtShare ?? 0) >= 0.6) {
    actions.push({
      priority: actions.length + 1,
      title: '拆分非房贷债务做分层处理',
      reason: '非房贷通常期限更短、月供压力更直接，是降月供方案的主要调节区。',
      action: '把经营贷、消费贷、车贷、信用卡分别列出，按月供金额和调整难度排序沟通。',
      evidence: [
        `非房贷余额占比：${formatRatio(analysis.metrics.nonMortgageDebtShare)}`,
        `非房贷月供：${formatYuan(analysis.metrics.nonMortgagePayment)}`,
      ],
    });
  }

  if (analysis.installmentCards.length > 0) {
    actions.push({
      priority: actions.length + 1,
      title: '核查信用卡账单分期空间',
      reason: '信用卡已用额度可通过账单分期、还款日安排等方式改善短期月供节奏。',
      action: '补充信用卡账单、账单日、还款日、可分期期数和手续费率，再决定是否纳入主方案。',
      evidence: [`可核查信用卡账户：${analysis.installmentCards.length} 个`],
    });
  }

  if (actions.length === 0) {
    actions.push({
      priority: 1,
      title: '先补齐合同与流水资料',
      reason: '当前征信结构未显示明显单一压降对象，需要结合实际合同和收入流水判断。',
      action: '补充贷款合同、还款计划、信用卡账单、近 6 个月收入流水和客户月度支出清单。',
      evidence: ['当前未触发明显结构集中、信用卡使用率或逾期类预警。'],
    });
  }

  return actions.slice(0, 5).map((item, index) => ({ ...item, priority: index + 1 }));
}

function buildDataAndRiskBody(
  analysis: DebtAnalysisReport,
  aiAnalysis?: LlmDebtAnalysis,
  reviewSummary?: OcrReviewExportSummary,
): string[] {
  const mainPlan = pickMainPlan(analysis);
  const topDebts = [...analysis.debtBreakdown]
    .filter((item) => item.balance > 0 || item.monthlyPayment > 0)
    .sort((a, b) => b.monthlyPayment - a.monthlyPayment)
    .slice(0, 2);
  const riskWarnings = dedupe([
    ...analysis.riskNotes,
    ...(aiAnalysis?.riskWarnings ?? []),
  ]).slice(0, 3);

  return [
    bullet(`关键数据：债务总额约 ${formatYuan(analysis.debtTotal)}，当前月供约 ${formatYuan(analysis.originalMonthlyPayment)}，非房贷占比 ${formatRatio(analysis.metrics.nonMortgageDebtShare)}。`),
    ...topDebts.map((item) => bullet(`${item.label}：余额约 ${formatYuan(item.balance)}，月供约 ${formatYuan(item.monthlyPayment)}。`)),
    mainPlan ? bullet(`方案预算：按 ${formatYuanRange(mainPlan.releasedCashFlow)} 作为可释放现金流的保守参考，先用低值安排客户预算。`) : '',
    reviewSummary ? bullet(`数据状态：未复核字段 ${reviewSummary.pendingCount} 项，建议先复核后执行。`) : '',
    ...riskWarnings.map((item) => bullet(item)),
    bullet('不得以逃废债、虚假沟通、隐瞒收入或伪造资料作为降低月供手段。'),
  ].filter(Boolean);
}

function pickMainPlan(analysis: DebtAnalysisReport): PaymentReductionPlan | undefined {
  const normal = analysis.plans.find((plan) => plan.key === 'normal-optimization');
  const mild = analysis.plans.find((plan) => plan.key === 'mild-negotiation');
  const term = analysis.plans.find((plan) => plan.key === 'term-extension');
  const meaningfulRelief = Math.max(800, analysis.originalMonthlyPayment * 0.1);

  if (normal && normal.releasedCashFlow >= meaningfulRelief) return normal;
  if (mild && mild.releasedCashFlow > 0) return mild;
  if (normal && normal.releasedCashFlow > 0) return normal;
  if (term && term.releasedCashFlow > 0) return term;
  return analysis.plans.find((plan) => plan.releasedCashFlow > 0) ?? analysis.plans[0];
}

function getLeadingDebt(analysis: DebtAnalysisReport) {
  return [...analysis.debtBreakdown]
    .filter((item) => item.balance > 0)
    .sort((a, b) => b.balance - a.balance)[0];
}

function getHighestPayment(analysis: DebtAnalysisReport) {
  return [...analysis.debtBreakdown]
    .filter((item) => item.monthlyPayment > 0)
    .sort((a, b) => b.monthlyPayment - a.monthlyPayment)[0];
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function buildDefaultFileName(report: CreditReport): string {
  const name = sanitizeFileName(report.header.name || '客户');
  const reportTime = sanitizeFileName(report.header.reportTime || new Date().toISOString().slice(0, 10));
  return `${name}_降低月供分析建议书_${reportTime}.docx`;
}

function ensureDocxExtension(fileName: string): string {
  return fileName.endsWith('.docx') ? fileName : `${fileName}.docx`;
}

function heading(text: string): string {
  return paragraph(text, { style: 'Heading1' });
}

function bullet(text: string): string {
  return `<w:p>
  <w:pPr><w:pStyle w:val="ListParagraph"/><w:ind w:left="420" w:hanging="180"/></w:pPr>
  <w:r><w:t>${escapeXml(`• ${text}`)}</w:t></w:r>
</w:p>`;
}

function paragraph(
  text: string,
  options: { style?: 'Title' | 'Heading1' | 'Heading2' | 'Note' | 'Small'; align?: 'center' | 'right' } = {},
): string {
  const style = options.style ? `<w:pStyle w:val="${options.style}"/>` : '';
  const align = options.align ? `<w:jc w:val="${options.align}"/>` : '';
  const pPr = style || align ? `<w:pPr>${style}${align}</w:pPr>` : '';
  return `<w:p>${pPr}<w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p>`;
}

function sectionProperties(): string {
  return `<w:sectPr>
  <w:pgSz w:w="11906" w:h="16838"/>
  <w:pgMar w:top="1440" w:right="1080" w:bottom="1440" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/>
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
  return xmlDeclaration(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`);
}

function buildCorePropsXml(analysis: DebtAnalysisReport): string {
  const now = analysis.generatedAt;
  return xmlDeclaration(`<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>客户降低月供分析建议书</dc:title>
  <dc:creator>征信贷小帮</dc:creator>
  <cp:lastModifiedBy>征信贷小帮</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${escapeXml(now)}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${escapeXml(now)}</dcterms:modified>
</cp:coreProperties>`);
}

function buildAppPropsXml(): string {
  return xmlDeclaration(`<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>征信贷小帮</Application>
</Properties>`);
}

function buildStylesXml(): string {
  return xmlDeclaration(`<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="SimSun" w:hAnsi="Arial"/><w:sz w:val="21"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:pPr><w:spacing w:after="240"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Microsoft YaHei" w:hAnsi="Arial"/><w:b/><w:sz w:val="34"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:pPr><w:spacing w:before="260" w:after="140"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Microsoft YaHei" w:hAnsi="Arial"/><w:b/><w:sz w:val="26"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:pPr><w:spacing w:before="180" w:after="100"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Microsoft YaHei" w:hAnsi="Arial"/><w:b/><w:sz w:val="22"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Note">
    <w:name w:val="Note"/>
    <w:pPr><w:spacing w:after="160"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="SimSun" w:hAnsi="Arial"/><w:color w:val="666666"/><w:sz w:val="20"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Small">
    <w:name w:val="Small"/>
    <w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="SimSun" w:hAnsi="Arial"/><w:color w:val="666666"/><w:sz w:val="18"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph">
    <w:name w:val="List Paragraph"/>
    <w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="SimSun" w:hAnsi="Arial"/><w:sz w:val="21"/></w:rPr>
  </w:style>
  <w:style w:type="table" w:styleId="TableGrid">
    <w:name w:val="Table Grid"/>
    <w:tblPr><w:tblBorders>
      <w:top w:val="single" w:sz="4" w:color="BFBFBF"/>
      <w:left w:val="single" w:sz="4" w:color="BFBFBF"/>
      <w:bottom w:val="single" w:sz="4" w:color="BFBFBF"/>
      <w:right w:val="single" w:sz="4" w:color="BFBFBF"/>
      <w:insideH w:val="single" w:sz="4" w:color="BFBFBF"/>
      <w:insideV w:val="single" w:sz="4" w:color="BFBFBF"/>
    </w:tblBorders></w:tblPr>
  </w:style>
</w:styles>`);
}

function formatYuan(value: number): string {
  return `${Math.round(value).toLocaleString('zh-CN')} 元`;
}

function formatYuanRange(value: number): string {
  const amount = Math.max(0, Math.round(value));
  if (amount <= 0) return '暂无法估算';
  const lower = Math.round(amount * 0.7);
  return `${lower.toLocaleString('zh-CN')}-${amount.toLocaleString('zh-CN')} 元`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatRatio(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  return `${Math.round(value * 1000) / 10}%`;
}

function sanitizeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim() || '客户';
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlDeclaration(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`;
}
