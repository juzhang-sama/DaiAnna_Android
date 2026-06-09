import { FINANCIAL_INSTITUTIONS } from '../data/financial-institutions';
import type { CreditReport, FieldProvenance } from '../types/credit-report';
import type { InstitutionCorrectionDiagnostic } from '../types/ocr-diagnostics';

interface InstitutionAlias {
  name: string;
  alias: string;
  normalizedAlias: string;
}

export interface InstitutionNormalizationResult {
  original: string;
  normalized: string;
  confidence: number;
  matched: boolean;
  applied: boolean;
  status: InstitutionCorrectionDiagnostic['status'];
  statusLabel: string;
  matchType: InstitutionCorrectionDiagnostic['matchType'];
  candidates: string[];
}

export interface CreditReportInstitutionNormalizationResult {
  report: CreditReport;
  corrections: InstitutionCorrectionDiagnostic[];
}

const INSTITUTION_ALIASES: InstitutionAlias[] = FINANCIAL_INSTITUTIONS.flatMap((entry) => {
  const aliases = [entry.name, ...(entry.aliases ?? [])];
  return aliases.map((alias) => ({
    name: entry.name,
    alias,
    normalizedAlias: normalizeComparableName(alias),
  }));
});

export function normalizeInstitutionName(raw: string): InstitutionNormalizationResult {
  const original = (raw ?? '').trim();
  const cleaned = cleanInstitutionText(original);
  const comparable = normalizeComparableName(cleaned);
  const uncertainOcr = hasUncertainOcrMarker(cleaned);

  if (isLikelyInstitutionFragment(cleaned)) {
    return buildResult(original, cleaned, 0, false, false, 'review', '疑似机构残片，请复核', 'none', []);
  }

  if (!comparable) {
    return buildResult(original, cleaned, 0, false, false, 'unlisted', '该机构未被收录', 'none', []);
  }

  const exact = INSTITUTION_ALIASES.find((item) => item.normalizedAlias === comparable);
  if (exact) {
    return buildResult(
      original,
      exact.name,
      exact.alias === exact.name ? 1 : 0.98,
      true,
      exact.name.trim() !== original,
      'matched',
      exact.alias === exact.name ? '机构库精确匹配' : '经机构库别名匹配',
      exact.alias === exact.name ? 'exact' : 'alias',
      [exact.name],
    );
  }

  const embeddedAlias = INSTITUTION_ALIASES
    .filter((item) => item.normalizedAlias.length >= 4 && comparable.includes(item.normalizedAlias))
    .sort((a, b) => b.normalizedAlias.length - a.normalizedAlias.length);
  if (embeddedAlias.length > 0) {
    const candidates = uniqueNames(embeddedAlias);
    if (uncertainOcr || candidates.length > 1) {
      return buildResult(
        original,
        embeddedAlias[0].name,
        0.92,
        false,
        false,
        'review',
        '疑似机构，请复核',
        'none',
        candidates,
      );
    }
    return buildResult(
      original,
      embeddedAlias[0].name,
      0.94,
      true,
      true,
      'matched',
      '经机构库匹配',
      'contains',
      candidates,
    );
  }

  const contains = INSTITUTION_ALIASES
    .filter((item) => comparable.includes(item.normalizedAlias) || item.normalizedAlias.includes(comparable))
    .map((item) => ({
      name: item.name,
      score: Math.min(comparable.length, item.normalizedAlias.length) / Math.max(comparable.length, item.normalizedAlias.length),
    }))
    .sort((a, b) => b.score - a.score);
  if (contains[0]?.score >= 0.72) {
    const topScore = contains[0].score;
    const closeCandidates = uniqueNames(contains.filter((item) => item.score >= topScore - 0.05));
    if (uncertainOcr || closeCandidates.length > 1) {
      return buildResult(
        original,
        contains[0].name,
        round(0.88 + contains[0].score * 0.08),
        false,
        false,
        'review',
        '疑似机构，请复核',
        'none',
        uniqueNames(contains),
      );
    }
    return buildResult(
      original,
      contains[0].name,
      round(0.88 + contains[0].score * 0.08),
      true,
      true,
      'matched',
      '经机构库匹配',
      'contains',
      uniqueNames(contains),
    );
  }

  const fuzzy = INSTITUTION_ALIASES
    .map((item) => ({
      name: item.name,
      score: similarity(comparable, item.normalizedAlias),
    }))
    .filter((item) => item.score >= 0.72)
    .sort((a, b) => b.score - a.score);

  const best = fuzzy[0];
  const second = fuzzy.find((item) => item.name !== best?.name);
  if (best && !uncertainOcr && best.score >= 0.82 && (!second || best.score - second.score >= 0.05)) {
    return buildResult(
      original,
      best.name,
      round(best.score),
      true,
      true,
      'matched',
      '经机构库模糊匹配',
      'fuzzy',
      uniqueNames(fuzzy),
    );
  }

  if (best) {
    return buildResult(
      original,
      best.name,
      round(best.score),
      false,
      false,
      'review',
      '疑似机构，请复核',
      'none',
      uniqueNames(fuzzy),
    );
  }

  return buildResult(original, cleaned, 0, false, false, 'unlisted', '该机构未被收录', 'none', []);
}

export function normalizeCreditReportInstitutions(
  report: CreditReport,
): CreditReportInstitutionNormalizationResult {
  const corrections: InstitutionCorrectionDiagnostic[] = [];
  const normalize = (field: string, org: string): string => {
    const result = normalizeInstitutionName(org);
    const source = findInstitutionSource(report, field);
    if (shouldRecordCorrection(result)) {
      corrections.push({
        field,
        original: result.original,
        normalized: result.normalized,
        sourceLabel: source?.label,
        pageNum: source?.pageNum,
        logicalPage: source?.logicalPage,
        precedingText: source?.precedingText,
        confidence: result.confidence,
        matched: result.matched,
        applied: result.applied,
        status: result.status,
        statusLabel: result.statusLabel,
        matchType: result.matchType,
        candidates: result.candidates.slice(0, 5),
      });
    }
    return result.matched ? result.normalized : org;
  };

  const next: CreditReport = {
    ...report,
    creditDetail: {
      ...report.creditDetail,
      nonRevolvingLoans: report.creditDetail.nonRevolvingLoans.map((account, index) => ({
        ...account,
        org: normalize(`creditDetail.nonRevolvingLoans[${index}].org`, account.org),
      })),
      revolvingLoansType1: report.creditDetail.revolvingLoansType1.map((account, index) => ({
        ...account,
        org: normalize(`creditDetail.revolvingLoansType1[${index}].org`, account.org),
      })),
      revolvingLoansType2: report.creditDetail.revolvingLoansType2.map((account, index) => ({
        ...account,
        org: normalize(`creditDetail.revolvingLoansType2[${index}].org`, account.org),
      })),
      creditCards: report.creditDetail.creditCards.map((account, index) => ({
        ...account,
        org: normalize(`creditDetail.creditCards[${index}].org`, account.org),
      })),
    },
    accountBriefs: report.accountBriefs.map((account, index) => ({
      ...account,
      org: normalize(`accountBriefs[${index}].org`, account.org),
    })),
    repayResponsibilities: report.repayResponsibilities.map((account, index) => ({
      ...account,
      org: normalize(`repayResponsibilities[${index}].org`, account.org),
    })),
    creditAgreements: report.creditAgreements.map((agreement, index) => ({
      ...agreement,
      org: normalize(`creditAgreements[${index}].org`, agreement.org),
    })),
    queryRecord: {
      ...report.queryRecord,
      orgQueries: report.queryRecord.orgQueries.map((query, index) => ({
        ...query,
        queryOrg: normalize(`queryRecord.orgQueries[${index}].queryOrg`, query.queryOrg),
      })),
    },
  };

  return { report: next, corrections };
}

function findInstitutionSource(report: CreditReport, field: string): FieldProvenance | undefined {
  const provenance = report.provenance ?? {};
  const listField = field.replace(/\[\d+\]\.[^.]+$/, '');
  const parentField = listField.replace(/\.[^.]+$/, '');
  return provenance[field] ??
    provenance[listField] ??
    provenance[parentField] ??
    provenance[field.split('[')[0]];
}

function shouldRecordCorrection(result: InstitutionNormalizationResult): boolean {
  if (!result.original.trim()) return false;
  if (result.status === 'unlisted' || result.status === 'review') return true;
  return result.matched && result.original.trim() !== result.normalized.trim();
}

function buildResult(
  original: string,
  normalized: string,
  confidence: number,
  matched: boolean,
  applied: boolean,
  status: InstitutionCorrectionDiagnostic['status'],
  statusLabel: string,
  matchType: InstitutionCorrectionDiagnostic['matchType'],
  candidates: string[],
): InstitutionNormalizationResult {
  return {
    original,
    normalized,
    confidence,
    matched,
    applied,
    status,
    statusLabel,
    matchType,
    candidates: candidates.slice(0, 5),
  };
}

function cleanInstitutionText(raw: string): string {
  return raw
    .replace(/\\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .find((line) =>
      /银行|消费金融|小额贷款|小贷|汽车金融|信用社|合作社|融资担保|担保|融资租赁|信托|财务公司/.test(line),
    ) ?? raw.trim();
}

function hasUncertainOcrMarker(value: string): boolean {
  return /[■□�]/.test(value);
}

function isLikelyInstitutionFragment(value: string): boolean {
  const cleaned = value.trim();
  if (!cleaned) return false;
  if (/^[\d,，.。:\-—年月日\s]+$/.test(cleaned)) return true;
  if (/^(信用卡中心|牡丹卡中心|销售中心|客服中心|分中心|网上银行|商业银行)$/.test(cleaned)) return true;
  if (/^[\u4e00-\u9fa5]{0,6}(?:信用卡中心|牡丹卡中心|销售中心|分中心)$/.test(cleaned)) return true;
  if (/^(?:股份|股|份|有限|公司|行股份|银行股份|小额贷款|消费金融)(?:有限)?(?:公司)?$/.test(cleaned)) return true;
  return false;
}

function normalizeComparableName(value: string): string {
  return stripInstitutionUnitSuffix(value)
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/贷[A-Za-z0-9]{2,}款/g, '贷款')
    .replace(/彳亍/g, '行')
    .replace(/發/g, '发')
    .replace(/[银很彳亍]/g, (char) => (char === '银' ? '银' : char === '很' ? '行' : ''))
    .replace(/帐/g, '账')
    .replace(/贷欵/g, '贷款')
    .replace(/小颁/g, '小额')
    .replace(/消费全融/g, '消费金融')
    .replace(/股份有限公公司/g, '股份有限公司')
    .replace(/有限公公司/g, '有限公司')
    .replace(/股付公司|股份公公司/g, '股份公司')
    .replace(/股份有限公(?!司)/g, '股份有限公司')
    .replace(/有限公(?!司)/g, '有限公司')
    .replace(/网网络/g, '网络')
    .replace(/络小额/g, '网络小额')
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '')
    .replace(/股份有限公司|有限责任公司|有限公司|股份公司/g, '')
    .replace(/中国/g, '')
    .toLowerCase();
}

function stripInstitutionUnitSuffix(value: string): string {
  let next = value
    .replace(/\s+/g, '')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')');

  // 银行分支、信用卡中心通常不是独立报送机构，先归到总行/总公司再匹配机构库。
  next = next.replace(
    /(银行)(?:股份|股分|有限|公司){0,8}[\u4e00-\u9fa5]{0,12}(?:分行|支行|营业部|营业室|分理处|分)$/,
    '$1',
  );
  next = next.replace(
    /(股份有限公司|有限责任公司|有限公司|股份公司)(?:[\u4e00-\u9fa5]{0,30}(?:信用卡中心|信用卡中|信用卡部|银行卡中心|银行卡业务部|银行卡部|牡丹卡中心|分中心|分行|支行|营业部|营业室|分理处|分))+.*$/,
    '$1',
  );
  next = next.replace(/(?:信用卡中心|信用卡中|信用卡部|银行卡中心|银行卡业务部|银行卡部|牡丹卡中心)(?:[\u4e00-\u9fa5]{0,12}分中心)?$/, '');
  next = next.replace(/[\u4e00-\u9fa5]{0,30}(?:分行|支行|营业部|营业室|分理处|分)$/, '');
  return next;
}

function uniqueNames(items: Array<{ name: string }>): string[] {
  return Array.from(new Set(items.map((item) => item.name)));
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const distance = levenshtein(a, b);
  const editScore = 1 - distance / Math.max(a.length, b.length);
  const diceScore = diceCoefficient(a, b);
  return Math.max(0, editScore * 0.55 + diceScore * 0.45);
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[a.length][b.length];
}

function diceCoefficient(a: string, b: string): number {
  const gramsA = bigrams(a);
  const gramsB = bigrams(b);
  if (gramsA.length === 0 || gramsB.length === 0) return 0;
  const counts = new Map<string, number>();
  gramsA.forEach((gram) => counts.set(gram, (counts.get(gram) ?? 0) + 1));
  let overlap = 0;
  gramsB.forEach((gram) => {
    const count = counts.get(gram) ?? 0;
    if (count <= 0) return;
    overlap++;
    counts.set(gram, count - 1);
  });
  return (2 * overlap) / (gramsA.length + gramsB.length);
}

function bigrams(value: string): string[] {
  if (value.length <= 1) return [value];
  return Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
