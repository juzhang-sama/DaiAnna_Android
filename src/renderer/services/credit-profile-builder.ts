/**
 * CreditProfile 构建器 — 从 CreditReport 派生六维度征信画像
 *
 * 设计原则：
 * - 每个维度独立构建函数，方便后续替换数据源或扩展逻辑
 * - repaymentRecords 相关计算已预留，当前 OCR 无法提取时返回 null
 * - 所有日期解析兼容 "2025.01.20" 和 "2025-01-20" 格式
 */

import type { CreditReport } from '../types/credit-report';
import type {
  CreditProfile, BasicAccess, HardInjury, DebtStatus,
  QueryFrequency, AssetStatus, CreditHistory,
} from '../types/credit-profile';
import { calcAgeAt, getReferenceDate, monthsBefore, parseDateLoose } from '../utils/date-utils';
import { isActiveCreditCardStatus } from '../utils/credit-card-status';

/** 计入查询次数的查询原因 */
const COUNTED_QUERY_REASONS = ['贷款审批', '信用卡审批', '担保资格审查'];

/** 房贷业务种类关键词 */
const MORTGAGE_KEYWORDS = ['住房', '房贷', '公积金贷款', '个人住房'];

/** 车贷业务种类关键词 */
const AUTO_LOAN_KEYWORDS = ['汽车', '车贷', '购车'];

/** 从 CreditReport 构建完整的 CreditProfile */
export function buildCreditProfile(report: CreditReport): CreditProfile {
  const referenceDate = getReferenceDate(report.header.reportTime);
  return {
    basicAccess: buildBasicAccess(report, referenceDate),
    hardInjury: buildHardInjury(report),
    debtStatus: buildDebtStatus(report, referenceDate),
    queryFrequency: buildQueryFrequency(report, referenceDate),
    assetStatus: buildAssetStatus(report),
    creditHistory: buildCreditHistory(report, referenceDate),
  };
}

function buildBasicAccess(r: CreditReport, referenceDate: Date): BasicAccess {
  const id = r.personalInfo.identity;
  return {
    age: calcAgeAt(id.birthDate, referenceDate),
    marriage: id.maritalStatus,
    employmentStatus: id.employmentStatus,
    registeredAddress: id.registeredAddress,
  };
}

function buildHardInjury(r: CreditReport): HardInjury {
  const cd = r.creditDetail;
  const allAccounts = [
    ...cd.nonRevolvingLoans, ...cd.revolvingLoansType1,
    ...cd.revolvingLoansType2, ...cd.creditCards,
  ];

  let currentOverdueCount = 0;
  let hasBadDebt = false;

  for (const a of allAccounts) {
    if (a.currentOverdueCount && a.currentOverdueCount > 0) currentOverdueCount++;
    if (/呆账|呆帐/.test(a.status)) hasBadDebt = true;
    if ('fiveCategory' in a && /损失/.test((a as { fiveCategory?: string | null }).fiveCategory ?? '')) {
      hasBadDebt = true;
    }
  }

  // 连三累六：依赖 repaymentRecords，当前 OCR 无法提取，预留 null
  const hasRepayData = allAccounts.some(a => a.repaymentRecords.length > 0);

  return {
    currentOverdueCount,
    maxConsecutiveOverdue: hasRepayData ? calcMaxConsecutive(allAccounts) : null,
    totalOverdueIn2Years: hasRepayData ? calcTotalOverdue2Y(allAccounts) : null,
    hasBadDebt,
    hasCompensation: r.repayResponsibilities.length > 0,
  };
}

function buildDebtStatus(r: CreditReport, referenceDate: Date): DebtStatus {
  const cd = r.creditDetail;
  const sixMonthsAgo = monthsBefore(referenceDate, 6);

  let totalLoanBalance = 0;
  let totalCardUsed = 0;
  let totalCardLimit = 0;
  let activeLoanCount = 0;
  let newLoanIn6Months = 0;
  let totalMonthlyPayment = 0;

  const allLoans = [
    ...cd.nonRevolvingLoans, ...cd.revolvingLoansType1, ...cd.revolvingLoansType2,
  ];
  for (const loan of allLoans) {
    const isClosed = /结清|销户/.test(loan.status);
    if (!isClosed) {
      activeLoanCount++;
      totalLoanBalance += loan.balance ?? 0;
      totalMonthlyPayment += loan.monthlyPayment ?? 0;
    }
    const openD = parseDateLoose(loan.openDate);
    if (openD && openD >= sixMonthsAgo && !isClosed) newLoanIn6Months++;
  }

  for (const card of cd.creditCards) {
    if (isActiveCreditCardStatus(card.status)) {
      totalCardUsed += card.usedAmount ?? 0;
      totalMonthlyPayment += card.monthlyPayment ?? 0;
      totalCardLimit += card.creditLimit;
    }
  }

  const cardUsageRate = totalCardLimit > 0
    ? Math.round((totalCardUsed / totalCardLimit) * 100) / 100
    : null;

  return {
    totalLoanBalance, totalCardUsed, cardUsageRate,
    activeLoanCount, newLoanIn6Months, totalMonthlyPayment,
  };
}

function buildQueryFrequency(r: CreditReport, referenceDate: Date): QueryFrequency {
  const qr = r.queryRecord;
  return {
    queryIn1Month: countQueries(qr.orgQueries, 1, referenceDate),
    queryIn3Months: countQueries(qr.orgQueries, 3, referenceDate),
    queryIn6Months: countQueries(qr.orgQueries, 6, referenceDate),
  };
}

function buildAssetStatus(r: CreditReport): AssetStatus {
  const allLoans = [
    ...r.creditDetail.nonRevolvingLoans,
    ...r.creditDetail.revolvingLoansType1,
    ...r.creditDetail.revolvingLoansType2,
  ];
  let hasMortgage = false;
  let hasAutoLoan = false;

  for (const loan of allLoans) {
    const bt = loan.businessType;
    if (MORTGAGE_KEYWORDS.some(k => bt.includes(k))) hasMortgage = true;
    if (AUTO_LOAN_KEYWORDS.some(k => bt.includes(k))) hasAutoLoan = true;
  }

  let totalCardCreditLimit = 0;
  for (const card of r.creditDetail.creditCards) {
    if (isActiveCreditCardStatus(card.status)) {
      totalCardCreditLimit += card.creditLimit;
    }
  }

  return { hasMortgage, hasAutoLoan, totalCardCreditLimit };
}

function buildCreditHistory(r: CreditReport, referenceDate: Date): CreditHistory {
  const cd = r.creditDetail;
  const allDates: string[] = [];

  for (const a of cd.nonRevolvingLoans) if (a.openDate) allDates.push(a.openDate);
  for (const a of cd.revolvingLoansType1) if (a.openDate) allDates.push(a.openDate);
  for (const a of cd.revolvingLoansType2) if (a.openDate) allDates.push(a.openDate);
  for (const a of cd.creditCards) if (a.openDate) allDates.push(a.openDate);

  let earliest: Date | null = null;
  let earliestStr: string | null = null;
  for (const ds of allDates) {
    const d = parseDateLoose(ds);
    if (d && (!earliest || d < earliest)) { earliest = d; earliestStr = ds; }
  }

  const creditYears = earliest
    ? Math.floor((referenceDate.getTime() - earliest.getTime()) / (365.25 * 86400000))
    : null;

  const allLoans = [
    ...cd.nonRevolvingLoans, ...cd.revolvingLoansType1, ...cd.revolvingLoansType2,
  ];
  const settledLoanCount = allLoans.filter(a => /结清/.test(a.status)).length;

  return { earliestOpenDate: earliestStr, creditYears, settledLoanCount };
}

// ── 工具函数 ──

/** 统计近 N 个月的审批类查询次数 */
function countQueries(
  queries: { queryDate: string; queryReason: string }[], months: number, referenceDate: Date,
): number {
  const cutoff = monthsBefore(referenceDate, months);
  let count = 0;
  for (const q of queries) {
    if (!COUNTED_QUERY_REASONS.some(r => q.queryReason.includes(r))) continue;
    const d = parseDateLoose(q.queryDate);
    if (d && d >= cutoff) count++;
  }
  return count;
}

/**
 * 从还款记录计算所有账户中最大连续逾期期数
 * 预留实现：当 repaymentRecords 有数据时启用
 */
function calcMaxConsecutive(
  accounts: { repaymentRecords: { year: number; months: (string | null)[] }[] }[],
): number {
  let maxConsec = 0;
  for (const a of accounts) {
    const codes = flattenRepaymentCodes(a.repaymentRecords);
    let consec = 0;
    for (const c of codes) {
      if (isOverdueCode(c)) { consec++; maxConsec = Math.max(maxConsec, consec); }
      else { consec = 0; }
    }
  }
  return maxConsec;
}

/**
 * 从还款记录计算近2年累计逾期次数
 * 预留实现：当 repaymentRecords 有数据时启用
 */
function calcTotalOverdue2Y(
  accounts: { repaymentRecords: { year: number; months: (string | null)[] }[] }[],
): number {
  let total = 0;
  for (const a of accounts) {
    const codes = flattenRepaymentCodes(a.repaymentRecords);
    total += codes.filter(isOverdueCode).length;
  }
  return total;
}

/** 将多年还款记录展平为按时间顺序的状态码数组 */
function flattenRepaymentCodes(
  records: { year: number; months: (string | null)[] }[],
): string[] {
  return [...records]
    .sort((a, b) => a.year - b.year)
    .flatMap(r => r.months.filter((m): m is string => m !== null));
}

/** 判断还款状态码是否为逾期（1-7 表示逾期月数） */
function isOverdueCode(code: string): boolean {
  return /^[1-7]$/.test(code);
}
