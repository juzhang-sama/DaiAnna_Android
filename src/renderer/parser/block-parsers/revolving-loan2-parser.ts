/**
 * 循环贷账户二明细解析器
 *
 * 从 DocParser 分组后的 ContextTable[] 提取 RevolvingLoanAccount[]
 *
 * 表格形态（由 OCR 识别结果决定）：
 * - 在贷完整表：24-25列（groupSize=4，25列时第0列为空偏移）
 * - 基本信息表：6-12列（groupSize=1-2），状态/还款在下一张续表
 * - 续表：headers 不含"管理机构"，跳过
 * - OCR 严重粘连表：headers 如 "管理机构账户标识开立日期"，尽力提取
 *
 * 与非循环贷的差异：
 * - headers 中是 "账户授信额度" 而非 "借款金额"
 * - 25列表格第0列为空偏移
 */

import type { RevolvingLoanAccount } from '../../types/credit-report';
import type { AccountSegment, ContextTable } from '../doc-table-bridge';
import {
  getGroupValue, findLabelGroup, getLabeledValue, parseNum,
  hasLoanHeader, cleanOrg, cleanStatus, cleanNumStr, tryMergeSplitTable,
  parseRepaymentRecords, findTableValueByLabels, mergeSegmentTablesForParsing,
} from './loan-table-utils';

/** 统一用 groupSize=1（合并单元格值已重复填充） */
const GS = 1;

/** 在 headers 中查找授信额度（兼容粘连 "账户授信额度账户币种"） */
function findCreditLimitGroup(headers: string[]): number {
  return findLabelGroup(headers, '账户授信额度', GS);
}

/** 判断25列空偏移表格：headers[0]为空且含"管理机构" */
function hasEmptyOffset(headers: string[]): boolean {
  return headers.length >= 24 && headers[0]?.trim() === '';
}

function extractStatus(rows: string[][], offset: number): string {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (!row.some(c => c.includes('状态'))) continue;
    const valueRow = rows[i + 1] ?? [];
    const idx = row.findIndex(c => c.includes('账户状态') || c.includes('状态'));
    const raw = valueRow[idx] ?? valueRow[0] ?? row[idx] ?? '';
    return raw || '结清';
  }

  const labelRow = rows[4] ?? [];
  const valueRow = rows[5] ?? [];
  // 在贷：row[4] 含 "账户状态"
  const idx = findLabelGroup(labelRow, '账户状态', GS);
  if (idx >= 0) return getGroupValue(valueRow, idx, GS) || '结清';
  // 结清：row[4] 含 "状态"
  const idx2 = findLabelGroup(labelRow, '状态', GS);
  if (idx2 >= 0) return getGroupValue(valueRow, idx2, GS) || '结清';
  return '结清';
}

/** 判断是否为续表（headers 不含管理机构） */
function isContinuation(ct: ContextTable): boolean {
  return !hasLoanHeader(ct);
}



/** 从单张完整账户表格提取 RevolvingLoanAccount */
function extractFromTable(ct: ContextTable): RevolvingLoanAccount {
  const { headers, rows } = ct.table;

  // 第一组：headers(标签) + row[0](值)
  const row0 = rows[0] ?? [];
  const orgRaw = findTableValueByLabels(ct.table, '管理机构') ||
    getGroupValue(row0, findLabelGroup(headers, '管理机构', GS), GS);
  const org = cleanOrg(orgRaw);
  const openDate = findTableValueByLabels(ct.table, '开立日期', 'date') ||
    getGroupValue(row0, findLabelGroup(headers, '开立日期', GS), GS);
  const endDate = findTableValueByLabels(ct.table, '到期日期', 'date') ||
    getGroupValue(row0, findLabelGroup(headers, '到期日期', GS), GS) || null;
  const limitIdx = findCreditLimitGroup(headers);
  const limitRaw = findTableValueByLabels(ct.table, '账户授信额度', 'amount') ||
    (limitIdx >= 0 ? getGroupValue(row0, limitIdx, GS) : '');
  const creditLimit = parseNum(cleanNumStr(limitRaw));
  const currencyRaw = findTableValueByLabels(ct.table, '账户币种') ||
    getGroupValue(row0, findLabelGroup(headers, '账户币种', GS), GS);
  const currency = cleanNumStr(currencyRaw);

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
  const statusRaw = extractStatus(rows, 0);
  const status = cleanStatus(statusRaw);
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
    creditLimit, currency, businessType, guaranteeType,
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

/** 从分组后的循环贷二表格提取所有账户，跳过续表，处理分栏截断 */
export function parseRevolvingLoans2(tables: ContextTable[]): RevolvingLoanAccount[] {
  const accounts: RevolvingLoanAccount[] = [];
  let idx = 0;
  while (idx < tables.length) {
    const ct = tables[idx];
    if (isContinuation(ct)) { idx++; continue; }

    const split = tryMergeSplitTable(tables, idx, t => hasLoanHeader(t), 2);
    if (split) {
      accounts.push(extractFromTable(split.merged));
      idx += split.skip;
    } else {
      accounts.push(extractFromTable(ct));
      idx++;
    }
  }
  return accounts;
}

export function parseRevolvingLoan2Segments(segments: AccountSegment[]): RevolvingLoanAccount[] {
  const accounts: RevolvingLoanAccount[] = [];
  for (const segment of segments) {
    const merged = mergeSegmentTablesForParsing(segment.tables);
    if (!merged) continue;
    const account = extractFromTable(merged);
    if (hasUsableRevolvingLoanFields(account)) {
      accounts.push(account);
      continue;
    }

    const parsed = parseRevolvingLoans2(segment.tables);
    if (parsed[0] && hasUsableRevolvingLoanFields(parsed[0])) accounts.push(parsed[0]);
  }
  return accounts;
}

function hasUsableRevolvingLoanFields(account: RevolvingLoanAccount): boolean {
  return Boolean(account.org.trim()) || account.creditLimit > 0;
}
