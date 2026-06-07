/**
 * 征信报告解析引擎入口（v2 — 基于区块识别器）
 *
 * 流程：fullText → 按行分割 → recognizeBlocks → 各区块解析器 → ClientProfile
 * 可选接收 RebuiltTable（旧路径）或 DocParserResult（新路径）
 */

import { ClientProfile, ConfidenceMap } from '../types/client-profile';
import {
  CreditReport, AccountDerivedMap, AccountBrief, CreditCardAccount, LoanAccount,
  RevolvingLoanAccount, createEmptyCreditReport,
} from '../types/credit-report';
import { recognizeBlocks, getLevel1Lines } from './block-recognizer';
import { Level1Block } from './block-types';
import { parseHeader } from './block-parsers/header-parser';
import { parseIdentity, parseLatestCompany } from './block-parsers/identity-parser';
import { aggregateAccountOverdue } from './block-parsers/account-overdue-parser';
import { computeSummaryFromAccounts, type AccountDerivedSummary } from './block-parsers/summary-from-accounts';
import { extractAccountBriefs } from './block-parsers/account-brief-extractor';
import { parseNonRevolvingLoanSegments } from './block-parsers/non-revolving-loan-parser';
import { parseRevolvingLoan1Segments } from './block-parsers/revolving-loan1-parser';
import { parseRevolvingLoan2Segments } from './block-parsers/revolving-loan2-parser';
import { parseCreditCardSegments } from './block-parsers/credit-card-parser';
import { parseRepayResponsibilities } from './block-parsers/repay-responsibility-parser';
import { parseCreditAgreements } from './block-parsers/credit-agreement-parser';
import { parseQueryRecords } from './block-parsers/query-record-parser';
import { buildClientProfile } from './block-parsers/profile-bridge';
import { findTableValueByLabels, parseNum } from './block-parsers/loan-table-utils';
import type { RebuiltTable } from './table-rebuilder';
import type { DocParserResult } from '../../shared/doc-parser-types';
import {
  extractTablesFromDoc,
  flattenAccountSegments,
  groupAccountSegments,
  groupAccountTables,
  isAccountSummaryTable,
  type ContextTable,
} from './doc-table-bridge';
import { classifyTables } from './table-classifier';
import { scanLevel1Sections, scanLevel2CreditSections } from './section-locator';
import { countAllSectionAccounts } from './section-search';
import { buildReportProvenance } from './provenance';

export interface ParseResult {
  profile: ClientProfile;
  confidence: ConfidenceMap;
  report: CreditReport;
  debugBlockMap?: import('./block-types').BlockMap;
}

/**
 * 征信报告解析引擎入口
 * 接收全文文本 + 可选的结构化表格（旧路径）或文档解析结果（新路径）
 */
export function parseCreditReport(
  fullText: string, table?: RebuiltTable, docResult?: DocParserResult,
): ParseResult {
  const lines = fullText.split('\n');
  const blockMap = recognizeBlocks(lines);

  // 提取文档解析的结构化表格（新路径）
  const docTables = docResult ? extractTablesFromDoc(docResult) : [];
  const classified = docTables.length > 0 ? classifyTables(docTables) : null;

  // 扫描一级/二级模块位置（新路径）
  let sectionCounts: ReturnType<typeof countAllSectionAccounts> | null = null;
  if (docResult) {
    scanLevel1Sections(docResult);
    scanLevel2CreditSections(docResult);
    // 新方案：基于关键词搜索统计账户数量
    sectionCounts = countAllSectionAccounts(docResult);
  }

  // 各区块解析
  const headerLines = getLevel1Lines(lines, blockMap, Level1Block.REPORT_HEADER) ?? [];
  const personalLines = getLevel1Lines(lines, blockMap, Level1Block.PERSONAL_INFO) ?? [];

  const header = parseHeader(headerLines, classified?.header);
  const identity = parseIdentity(personalLines, classified?.identity);
  const latestCompany = parseLatestCompany(personalLines, classified?.job);
  const accountOverdue = aggregateAccountOverdue(lines, blockMap.accounts, table, docTables);
  const creditAccountTables = classified?.creditAccount ?? [];
  const initialAccountDerived = computeSummaryFromAccounts(lines, blockMap.accounts, table, creditAccountTables);

  // 按正确阅读顺序构建账户段；分类器可能无法识别无表头续表，因此这里使用全表事件流。
  const accountStreamTables = docTables.length > 0 ? docTables : creditAccountTables;
  const accountSummaryCandidates = accountStreamTables.length > 0
    ? extractAccountSummaryCandidates(accountStreamTables) : {};
  const accountSegments = accountStreamTables.length > 0
    ? groupAccountSegments(accountStreamTables) : null;
  const accountGroups = accountSegments
    ? flattenAccountSegments(accountSegments)
    : (creditAccountTables.length > 0 ? groupAccountTables(creditAccountTables) : null);

  // 组装完整征信报告对象
  const report = createEmptyCreditReport();
  report.header = header;
  report.personalInfo.identity = identity;
  report.accountDerived = convertDerivedMap(initialAccountDerived);
  report.accountBriefs = extractAccountBriefs(creditAccountTables);
  report.provenance = buildReportProvenance(classified, accountGroups);

  // 从账户段提取账户明细
  if (accountSegments) {
    report.creditDetail.nonRevolvingLoans = parseNonRevolvingLoanSegments(accountSegments.nonRevolvingLoan);
    report.creditDetail.revolvingLoansType1 = parseRevolvingLoan1Segments(accountSegments.revolvingLoan1);
    report.creditDetail.revolvingLoansType2 = parseRevolvingLoan2Segments(accountSegments.revolvingLoan2);
    report.creditDetail.creditCards = parseCreditCardSegments(accountSegments.creditCard);
  }

  if (accountGroups) {
    report.repayResponsibilities = parseRepayResponsibilities(accountGroups.repayResponsibility);
  }

  // 授信协议从 classified 桶直接解析（不走 groupAccountTables）
  if (classified) {
    report.creditAgreements = parseCreditAgreements(classified.creditAgreement);
    const queryResult = parseQueryRecords(classified.queryDetail, classified.unclassified);
    report.queryRecord = queryResult;
  }

  // 用新方案的账户数量覆盖 accountDerived 中的 accountCount
  if (sectionCounts) {
    const emptyDerived = { orgCount: 0, accountCount: 0, totalCredit: 0, balance: 0, monthlyPayment: 0 };

    if (!report.accountDerived.nonRevolvingLoan) {
      report.accountDerived.nonRevolvingLoan = { ...emptyDerived };
    }
    report.accountDerived.nonRevolvingLoan.accountCount = sectionCounts.nonRevolvingLoan;

    if (!report.accountDerived.revolvingLoan1) {
      report.accountDerived.revolvingLoan1 = { ...emptyDerived };
    }
    report.accountDerived.revolvingLoan1.accountCount = sectionCounts.revolvingLoan1;

    if (!report.accountDerived.revolvingLoan2) {
      report.accountDerived.revolvingLoan2 = { ...emptyDerived };
    }
    report.accountDerived.revolvingLoan2.accountCount = sectionCounts.revolvingLoan2;

    if (!report.accountDerived.creditCard) {
      report.accountDerived.creditCard = { ...emptyDerived };
    }
    report.accountDerived.creditCard.accountCount = sectionCounts.creditCard;
  }

  repairParsedAccountAmounts(report, accountSummaryCandidates);
  report.accountDerived = enrichDerivedFromParsedAccounts(report);

  // 构建 ClientProfile（从账户明细反算 + 查询记录明细）
  const profile = buildClientProfile({
    header, identity, latestCompany, accountOverdue,
    accountDerived: report.accountDerived as Record<string, AccountDerivedSummary>,
    queryRecord: report.queryRecord,
  });

  const confidence = buildConfidence(profile, report.accountDerived as Record<string, AccountDerivedSummary>);
  return { profile, confidence, report, debugBlockMap: blockMap };
}

/** 将解析器的 Record<string, AccountDerivedSummary> 转为类型安全的 AccountDerivedMap */
function convertDerivedMap(raw: Record<string, AccountDerivedSummary>): AccountDerivedMap {
  return {
    nonRevolvingLoan: raw['nonRevolvingLoan'],
    revolvingLoan1: raw['revolvingLoan1'],
    revolvingLoan2: raw['revolvingLoan2'],
    creditCard: raw['creditCard'],
  };
}

type LoanSummaryKey = 'nonRevolvingLoan' | 'revolvingLoan1' | 'revolvingLoan2';
type LoanCreditField = 'loanAmount' | 'creditLimit';
type LoanLikeAccount = LoanAccount | RevolvingLoanAccount;

interface AccountSummaryCandidate {
  accountCount: number;
  totalCredit: number;
  balance: number;
  monthlyPayment: number;
}

type AccountSummaryCandidateMap = Partial<Record<LoanSummaryKey, AccountSummaryCandidate>>;

function extractAccountSummaryCandidates(tables: ContextTable[]): AccountSummaryCandidateMap {
  const groups = groupAccountTables(tables);
  return {
    nonRevolvingLoan: extractAccountSummaryCandidate(groups.nonRevolvingLoan, '借款金额'),
    revolvingLoan1: extractAccountSummaryCandidate(groups.revolvingLoan1, '借款金额'),
    revolvingLoan2: extractAccountSummaryCandidate(groups.revolvingLoan2, '账户授信额度'),
  };
}

function extractAccountSummaryCandidate(
  tables: ContextTable[] | undefined,
  creditLabel: string,
): AccountSummaryCandidate | undefined {
  for (const ct of tables ?? []) {
    if (!isAccountSummaryTable(ct)) continue;
    const summary = {
      accountCount: parseNum(findTableValueByLabels(ct.table, '账户数', 'amount')),
      totalCredit: parseNum(findTableValueByLabels(ct.table, creditLabel, 'amount')),
      balance: parseNum(findTableValueByLabels(ct.table, '余额', 'amount')),
      monthlyPayment: parseNum(findTableValueByLabels(
        ct.table,
        ['本月应还款', '本月应还', '应还款额', '本期应还', '最近6个月平均应还款'],
        'amount',
      )),
    };
    if (summary.accountCount > 0 || summary.totalCredit > 0 || summary.balance > 0 || summary.monthlyPayment > 0) {
      return summary;
    }
  }
  return undefined;
}

function repairParsedAccountAmounts(
  report: CreditReport,
  summaries: AccountSummaryCandidateMap,
): void {
  repairLoanGroupBalances(report, 'nonRevolvingLoan', report.creditDetail.nonRevolvingLoans, summaries.nonRevolvingLoan, 'loanAmount');
  repairLoanGroupBalances(report, 'revolvingLoan1', report.creditDetail.revolvingLoansType1, summaries.revolvingLoan1, 'loanAmount');
  repairLoanGroupBalances(report, 'revolvingLoan2', report.creditDetail.revolvingLoansType2, summaries.revolvingLoan2, 'creditLimit');
}

function repairLoanGroupBalances(
  report: CreditReport,
  category: LoanSummaryKey,
  accounts: LoanLikeAccount[],
  summary: AccountSummaryCandidate | undefined,
  creditField: LoanCreditField,
): void {
  if (!summary || summary.balance <= 0 || accounts.length === 0) return;
  if (summary.accountCount > 0 && summary.accountCount !== accounts.length) return;

  const activeAccounts = accounts
    .map((account, index) => ({ account, index }))
    .filter(({ account }) => !isClosedAccount(account.status));
  const suspiciousAccounts = activeAccounts.filter(({ account }) => hasSuspiciousLoanBalance(account));
  if (suspiciousAccounts.length === 0) return;

  if (activeAccounts.length === 1) {
    const target = suspiciousAccounts[0];
    if (target && applyLoanBalanceRepair(target.account, summary.balance, creditField)) {
      syncAccountBriefBalance(report, category, accounts, target.index, creditField);
    }
    return;
  }

  const detailBalanceTotal = activeAccounts.reduce((sum, { account }) => sum + (account.balance ?? 0), 0);
  if (summary.balance <= detailBalanceTotal) return;

  const repairable = suspiciousAccounts
    .map(({ account, index }) => ({
      account,
      index,
      candidate: summary.balance - (detailBalanceTotal - (account.balance ?? 0)),
    }))
    .filter(({ account, candidate }) => canUseBalanceCandidate(account, candidate, creditField));

  if (repairable.length !== 1) return;
  const { account, index, candidate } = repairable[0];
  account.balance = candidate;
  syncAccountBriefBalance(report, category, accounts, index, creditField);
}

function hasSuspiciousLoanBalance(account: LoanLikeAccount): boolean {
  const balance = account.balance ?? 0;
  const monthlyPayment = account.monthlyPayment ?? 0;
  return balance > 0 && monthlyPayment > balance * 1.2;
}

function applyLoanBalanceRepair(
  account: LoanLikeAccount,
  candidate: number,
  creditField: LoanCreditField,
): boolean {
  if (!canUseBalanceCandidate(account, candidate, creditField)) return false;
  account.balance = candidate;
  return true;
}

function canUseBalanceCandidate(
  account: LoanLikeAccount,
  candidate: number,
  creditField: LoanCreditField,
): boolean {
  const current = account.balance ?? 0;
  const monthlyPayment = account.monthlyPayment ?? 0;
  const creditAmount = getLoanCreditAmount(account, creditField);

  if (!Number.isFinite(candidate) || candidate <= current) return false;
  if (monthlyPayment > 0 && candidate < monthlyPayment) return false;
  if (creditAmount > 0 && candidate > creditAmount * 1.05) return false;
  return true;
}

function getLoanCreditAmount(account: LoanLikeAccount, creditField: LoanCreditField): number {
  return creditField === 'loanAmount'
    ? ((account as LoanAccount).loanAmount ?? 0)
    : ((account as RevolvingLoanAccount).creditLimit ?? 0);
}

function syncAccountBriefBalance(
  report: CreditReport,
  category: LoanSummaryKey,
  accounts: LoanLikeAccount[],
  accountIndex: number,
  creditField: LoanCreditField,
): void {
  const account = accounts[accountIndex];
  const briefIndexes = report.accountBriefs
    .map((brief, index) => ({ brief, index }))
    .filter(({ brief }) => brief.category === category && isAccountDetailBrief(brief));

  const matching = briefIndexes.filter(({ brief }) => matchesLoanBrief(brief, account, creditField));
  const targetIndex = matching.length === 1
    ? matching[0].index
    : (briefIndexes.length === accounts.length ? briefIndexes[accountIndex]?.index : undefined);

  if (targetIndex === undefined) return;
  report.accountBriefs[targetIndex] = {
    ...report.accountBriefs[targetIndex],
    balance: account.balance ?? report.accountBriefs[targetIndex].balance,
    monthlyPayment: account.monthlyPayment ?? report.accountBriefs[targetIndex].monthlyPayment,
  };
}

function isAccountDetailBrief(brief: AccountBrief): boolean {
  return Boolean(brief.org.trim() || brief.openDate.trim());
}

function matchesLoanBrief(
  brief: AccountBrief,
  account: LoanLikeAccount,
  creditField: LoanCreditField,
): boolean {
  const orgMatches = Boolean(brief.org.trim() && account.org.trim() &&
    normalizeComparableText(brief.org) === normalizeComparableText(account.org));
  const openDateMatches = Boolean(brief.openDate && account.openDate && brief.openDate === account.openDate);
  const creditMatches = amountsClose(brief.creditAmount, getLoanCreditAmount(account, creditField));

  return (orgMatches && (openDateMatches || creditMatches || !brief.openDate)) ||
    (openDateMatches && creditMatches);
}

function normalizeComparableText(value: string): string {
  return value.replace(/\s+/g, '').replace(/[■□�]/g, '');
}

function amountsClose(a: number, b: number): boolean {
  if (a <= 0 || b <= 0) return false;
  return Math.abs(a - b) <= 1;
}

function isClosedAccount(status: string): boolean {
  return /结清|销户|未激活/.test(status);
}

function enrichDerivedFromParsedAccounts(report: CreditReport): AccountDerivedMap {
  const detail = buildDerivedFromCreditDetail(report);
  const briefs = buildDerivedFromBriefs(report.accountBriefs);

  return {
    nonRevolvingLoan: mergeDerivedSummary(report.accountDerived.nonRevolvingLoan, detail.nonRevolvingLoan, briefs.nonRevolvingLoan),
    revolvingLoan1: mergeDerivedSummary(report.accountDerived.revolvingLoan1, detail.revolvingLoan1, briefs.revolvingLoan1),
    revolvingLoan2: mergeDerivedSummary(report.accountDerived.revolvingLoan2, detail.revolvingLoan2, briefs.revolvingLoan2),
    creditCard: mergeDerivedSummary(report.accountDerived.creditCard, detail.creditCard, briefs.creditCard),
  };
}

function mergeDerivedSummary(
  current: AccountDerivedSummary | undefined,
  ...fallbacks: Array<AccountDerivedSummary | undefined>
): AccountDerivedSummary | undefined {
  const parsed = fallbacks.find((fallback) => (fallback?.accountCount ?? 0) > 0);
  let next = current ? { ...current } : undefined;
  for (const fallback of fallbacks) {
    if (!fallback) continue;
    if (!next) {
      next = { ...fallback };
      continue;
    }
    if (next.orgCount <= 0 && fallback.orgCount > 0) next.orgCount = fallback.orgCount;
    if (next.accountCount <= 0 && fallback.accountCount > 0) next.accountCount = fallback.accountCount;
    if (next.totalCredit <= 0 && fallback.totalCredit > 0) next.totalCredit = fallback.totalCredit;
    if (next.balance <= 0 && fallback.balance > 0) next.balance = fallback.balance;
    if (next.monthlyPayment <= 0 && fallback.monthlyPayment > 0) next.monthlyPayment = fallback.monthlyPayment;
  }
  if (parsed) {
    next = next ? { ...next } : { ...parsed };
    next.accountCount = parsed.accountCount;
    if (parsed.orgCount > 0) next.orgCount = parsed.orgCount;
    if (parsed.totalCredit > 0) next.totalCredit = parsed.totalCredit;
    if (parsed.balance > 0) next.balance = parsed.balance;
    if (parsed.monthlyPayment > 0) next.monthlyPayment = parsed.monthlyPayment;
  }
  return next;
}

function buildDerivedFromCreditDetail(report: CreditReport): AccountDerivedMap {
  return {
    nonRevolvingLoan: aggregateLoanDetails(report.creditDetail.nonRevolvingLoans, 'loanAmount'),
    revolvingLoan1: aggregateLoanDetails(report.creditDetail.revolvingLoansType1, 'loanAmount'),
    revolvingLoan2: aggregateLoanDetails(report.creditDetail.revolvingLoansType2, 'creditLimit'),
    creditCard: aggregateCardDetails(report.creditDetail.creditCards),
  };
}

function aggregateLoanDetails(
  accounts: Array<LoanAccount | RevolvingLoanAccount>,
  creditField: 'loanAmount' | 'creditLimit',
): AccountDerivedSummary | undefined {
  if (accounts.length === 0) return undefined;
  const orgs = new Set<string>();
  let totalCredit = 0;
  let balance = 0;
  let monthlyPayment = 0;

  for (const account of accounts) {
    if (account.org) orgs.add(account.org);
    totalCredit += creditField === 'loanAmount'
      ? ((account as LoanAccount).loanAmount ?? 0)
      : ((account as RevolvingLoanAccount).creditLimit ?? 0);
    if (/结清|销户/.test(account.status)) continue;
    balance += account.balance ?? 0;
    monthlyPayment += account.monthlyPayment ?? 0;
  }

  return { orgCount: orgs.size, accountCount: accounts.length, totalCredit, balance, monthlyPayment };
}

function aggregateCardDetails(accounts: CreditCardAccount[]): AccountDerivedSummary | undefined {
  if (accounts.length === 0) return undefined;
  const orgs = new Set<string>();
  let totalCredit = 0;
  let balance = 0;
  let monthlyPayment = 0;

  for (const account of accounts) {
    if (account.org) orgs.add(account.org);
    totalCredit += account.creditLimit ?? 0;
    if (/结清|销户|未激活/.test(account.status)) continue;
    balance += account.usedAmount ?? 0;
    monthlyPayment += account.monthlyPayment ?? 0;
  }

  return { orgCount: orgs.size, accountCount: accounts.length, totalCredit, balance, monthlyPayment };
}

function buildDerivedFromBriefs(briefs: AccountBrief[]): AccountDerivedMap {
  const groups: Record<string, AccountBrief[]> = {};
  for (const brief of briefs) {
    if (!groups[brief.category]) groups[brief.category] = [];
    groups[brief.category].push(brief);
  }
  return {
    nonRevolvingLoan: aggregateBriefs(groups.nonRevolvingLoan),
    revolvingLoan1: aggregateBriefs(groups.revolvingLoan1),
    revolvingLoan2: aggregateBriefs(groups.revolvingLoan2),
    creditCard: aggregateBriefs(groups.creditCard),
  };
}

function aggregateBriefs(briefs: AccountBrief[] | undefined): AccountDerivedSummary | undefined {
  if (!briefs?.length) return undefined;
  const orgs = new Set<string>();
  let totalCredit = 0;
  let balance = 0;
  let monthlyPayment = 0;
  for (const brief of briefs) {
    if (brief.org) orgs.add(brief.org);
    totalCredit += brief.creditAmount ?? 0;
    if (brief.isClosed) continue;
    balance += brief.balance ?? 0;
    monthlyPayment += brief.monthlyPayment ?? 0;
  }
  return { orgCount: orgs.size, accountCount: briefs.length, totalCredit, balance, monthlyPayment };
}

/** 置信度计算 — 全部基于账户明细反算值，不再依赖 OCR 概要 */
function buildConfidence(
  profile: ClientProfile,
  derived?: Record<string, AccountDerivedSummary>,
): ConfidenceMap {
  const conf: ConfidenceMap = {};
  for (const key of Object.keys(profile) as (keyof ClientProfile)[]) {
    const val = profile[key];
    if (val === null || val === undefined || val === '') {
      conf[key] = 0;
      continue;
    }
    conf[key] = getFieldConfidence(key, derived);
  }
  return conf;
}

/** 按字段类型返回置信度 */
function getFieldConfidence(
  key: keyof ClientProfile,
  derived?: Record<string, AccountDerivedSummary>,
): number {
  if (['name', 'idCard', 'age', 'marriage', 'company'].includes(key)) return 0.90;
  if (['q1m', 'q2m', 'q6m'].includes(key)) return 0.75;
  if (['overdueCurrent', 'overdueHistory'].includes(key)) return 0.80;
  if (['totalCreditLimit', 'usedCreditLimit'].includes(key)) return derived?.creditCard ? 0.80 : 0.60;
  if (key === 'monthlyRepayment') return derived ? 0.75 : 0.60;
  return 0.65;
}
