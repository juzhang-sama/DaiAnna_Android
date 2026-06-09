/**
 * 循环贷账户一明细解析器
 *
 * 从 DocParser 分组后的 ContextTable[] 提取 LoanAccount[]
 *
 * 表格形态（由 OCR 识别结果决定）：
 * - 结清账户：18列（groupSize=3）或 22列（不均匀合并）
 * - 在贷账户：预期 24列（groupSize=4），暂无样本
 * - 所有合并单元格值都重复填充，故统一用 groupSize=1 安全取值
 *
 * 与非循环贷的差异：
 * - row[4] 标签为 "账户状态账户关闭日期" 或 "状态"+"账户关闭日期"
 * - OCR 可能将 "借款金额" 识别为 "僧款金额"
 */

import type { LoanAccount } from '../../types/credit-report';
import type { AccountSegment, ContextTable } from '../doc-table-bridge';
import {
  getGroupValue, findLabelGroup, getLabeledValue, parseNum,
  isContinuationTable, hasLoanHeader, tryMergeSplitTable,
  parseRepaymentRecords, findTableValueByLabels, mergeSegmentTablesForParsing,
  cleanStatus,
} from './loan-table-utils';

/** 循环贷一统一用 groupSize=1（合并单元格值已重复填充，无需分组） */
const GS = 1;

/** 在 headers 中查找借款金额（兼容 OCR 变体 "僧款金额"） */
function findLoanAmountGroup(headers: string[]): number {
  const idx = findLabelGroup(headers, '借款金额', GS);
  return idx >= 0 ? idx : findLabelGroup(headers, '僧款金额', GS);
}

/** 从 row[4] 标签行判断账户状态（结清/在贷） */
function extractStatus(rows: string[][]): string {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (!row.some(c => c.includes('状态'))) continue;
    const valueRow = rows[i + 1] ?? [];
    const idx = row.findIndex(c => c.includes('账户状态') || c.includes('状态'));
    const raw = valueRow[idx] ?? valueRow[0] ?? row[idx] ?? '';
    return cleanStatus(raw) || '结清';
  }

  const labelRow = rows[4] ?? [];
  const valueRow = rows[5] ?? [];

  // 在贷账户：row[4] 含 "账户状态" 标签（不含 "关闭"）
  if (labelRow.some(c => c.includes('账户状态') && !c.includes('关闭'))) {
    return getLabeledValue(labelRow, valueRow, '账户状态', GS) || '结清';
  }
  // 结清账户：row[4] 含 "状态" 或 "账户状态账户关闭日期"
  if (labelRow.some(c => c.includes('状态'))) {
    return getGroupValue(valueRow, 0, 1) || '结清';
  }
  return '结清';
}

/** 从单张完整账户表格提取 LoanAccount */
function extractLoanFromTable(ct: ContextTable): LoanAccount {
  const { headers, rows } = ct.table;

  // 第一组：headers(标签) + row[0](值)
  const row0 = rows[0] ?? [];
  const org = findTableValueByLabels(ct.table, '管理机构') ||
    getGroupValue(row0, findLabelGroup(headers, '管理机构', GS), GS);
  const openDate = findTableValueByLabels(ct.table, '开立日期', 'date') ||
    getGroupValue(row0, findLabelGroup(headers, '开立日期', GS), GS);
  const endDate = findTableValueByLabels(ct.table, '到期日期', 'date') ||
    getGroupValue(row0, findLabelGroup(headers, '到期日期', GS), GS) || null;
  const amountIdx = findLoanAmountGroup(headers);
  const amountRaw = findTableValueByLabels(ct.table, ['借款金额', '僧款金额', '款金'], 'amount') ||
    (amountIdx >= 0 ? getGroupValue(row0, amountIdx, GS) : '');
  const loanAmount = parseNum(amountRaw);
  const currency = findTableValueByLabels(ct.table, '账户币种') ||
    getGroupValue(row0, findLabelGroup(headers, '账户币种', GS), GS);

  // 第二组：row[1](标签) + row[2](值)
  const labelRow1 = rows[1] ?? [];
  const valueRow1 = rows[2] ?? [];
  const businessType = getLabeledValue(labelRow1, valueRow1, '业务种类', GS) ||
    findTableValueByLabels(ct.table, '业务种类');
  const guaranteeType = getLabeledValue(labelRow1, valueRow1, '保方式', GS) ||
    findTableValueByLabels(ct.table, '保方式');
  const termCount = getLabeledValue(labelRow1, valueRow1, '还款期数', GS) ||
    findTableValueByLabels(ct.table, '还款期数', 'amount');
  const repayMethod = getLabeledValue(labelRow1, valueRow1, '还款方式', GS) ||
    findTableValueByLabels(ct.table, '还款方式');

  // 第三组：row[4]+row[5] — 账户状态与五级分类
  const status = extractStatus(rows);
  const isClosed = /结清|销户/.test(status);
  let fiveCategory: string | null = null;

  let balance: number | null = null;
  let remainTerms: number | null = null;
  let monthlyPayment: number | null = null;
  let paymentDueDate: string | null = null;
  let actualPayment: number | null = null;
  let currentOverdueCount: number | null = null;
  let currentOverdueAmount: number | null = null;

  const lr2 = rows[4] ?? [];
  const vr2 = rows[5] ?? [];
  fiveCategory = getLabeledValue(lr2, vr2, '五级分类', GS) || null;

  if (!isClosed) {
    balance = parseNum(
      findTableValueByLabels(ct.table, ['余额', '佘额'], 'amount') ||
      getLabeledValue(lr2, vr2, '余额', GS),
    );
    remainTerms = parseNum(
      findTableValueByLabels(ct.table, ['剩余还款期数', '剩余期数', '剩余还款'], 'amount') ||
      getLabeledValue(lr2, vr2, '剩余还款期数', GS),
    ) || null;
    monthlyPayment = parseNum(
      findTableValueByLabels(ct.table, ['本月应还款', '本月应还', '应还款额', '本期应还'], 'amount') ||
      getLabeledValue(lr2, vr2, '本月应还款', GS),
    );
    paymentDueDate = findTableValueByLabels(ct.table, '应还款日', 'date') ||
      getLabeledValue(lr2, vr2, '应还款日', GS) || null;
    actualPayment = parseNum(
      findTableValueByLabels(ct.table, '本月实还款', 'amount') ||
      getLabeledValue(lr2, vr2, '本月实还款', GS),
    );

    const lr3 = rows[6] ?? [];
    const vr3 = rows[7] ?? [];
    currentOverdueCount = parseNum(getLabeledValue(lr3, vr3, '当前逾期期数', GS)) || null;
    currentOverdueAmount = parseNum(getLabeledValue(lr3, vr3, '当前逾期总额', GS)) || null;
  }

  return {
    org, accountId: '', openDate, endDate,
    loanAmount, currency, businessType, guaranteeType,
    termCount: termCount ? parseInt(termCount, 10) || null : null,
    termFrequency: null, repayMethod: repayMethod || null,
    jointLoanFlag: null,
    status, fiveCategory, closeDate: null,
    balance, remainTerms, monthlyPayment, paymentDueDate,
    actualPayment, currentOverdueCount, currentOverdueAmount,
    overdue31_60: null, overdue61_90: null,
    overdue91_180: null, overdue180plus: null,
    specialTransactions: [], repaymentRecords: parseRepaymentRecords(rows), dataSource: null,
  };
}

/** 循环贷一章节首表匹配 */
const SECTION_PREFIX = /^\(二\)/;

/** 从分组后的循环贷一表格提取所有账户，跳过续表，处理分栏截断 */
export function parseRevolvingLoans1(tables: ContextTable[]): LoanAccount[] {
  const accounts: LoanAccount[] = [];
  let idx = 0;
  while (idx < tables.length) {
    const ct = tables[idx];
    if (isContinuationTable(ct, SECTION_PREFIX) && !hasLoanHeader(ct)) { idx++; continue; }
    if (!hasLoanHeader(ct)) { idx++; continue; }

    const split = tryMergeSplitTable(tables, idx, t => hasLoanHeader(t), 2);
    if (split) {
      accounts.push(extractLoanFromTable(split.merged));
      idx += split.skip;
    } else {
      accounts.push(extractLoanFromTable(ct));
      idx++;
    }
  }
  return accounts;
}

export function parseRevolvingLoan1Segments(segments: AccountSegment[]): LoanAccount[] {
  const accounts: LoanAccount[] = [];
  for (const segment of segments) {
    const merged = mergeSegmentTablesForParsing(segment.tables);
    if (!merged) continue;
    const account = extractLoanFromTable(merged);
    if (hasUsableLoanFields(account)) {
      accounts.push(account);
      continue;
    }

    const parsed = parseRevolvingLoans1(segment.tables);
    if (parsed[0] && hasUsableLoanFields(parsed[0])) accounts.push(parsed[0]);
  }
  return accounts;
}

function hasUsableLoanFields(account: LoanAccount): boolean {
  return Boolean(account.org.trim()) || account.loanAmount > 0;
}
