/**
 * 贷记卡账户明细解析器
 *
 * 从 DocParser 分组后的 ContextTable[] 提取 CreditCardAccount[]
 *
 * 表格形态（由 OCR 识别结果决定）：
 * - 完整在贷表：22-26列，headers 含"发卡机构"，row[0] 基本信息，row[2]/row[3] 状态+已用额度
 * - 基本信息表：8-14列，仅发卡机构+授信额度，后续数据在续表
 * - 续表：headers 不含"发卡机构"/"卡机构"，跳过
 * - 销户表：row[2] 含"销户日期"，row[3] 值为"销户"
 * - 未激活表：row[1] 含"未激活"
 *
 * 与贷款类的差异：
 * - headers 用"发卡机构"而非"管理机构"（OCR 可能识别为"卡机构"）
 * - 授信额度可能粘连在"开立日期"中（如 "2016.06.21\n10000"）
 * - 账户状态/已用额度在 row[2]/row[3]（不是 row[4]/row[5]）
 */

import type { CreditCardAccount } from '../../types/credit-report';
import type { AccountSegment, ContextTable } from '../doc-table-bridge';
import type { ParsedTable } from '../markdown-table-parser';
import {
  getGroupValue, findLabelGroup, parseNum,
  cleanOrg, cleanStatus, cleanNumStr, tryMergeSplitTable,
  parseRepaymentRecords, findTableValueByLabels, mergeSegmentTablesForParsing,
} from './loan-table-utils';

const GS = 1;

/** 判断是否为贷记卡账户表（headers 含"发卡机构"或"卡机构"） */
function isCardHeader(ct: ContextTable): boolean {
  return findLabelGroup(ct.table.headers, '发卡机构', GS) >= 0 ||
    findLabelGroup(ct.table.headers, '卡机构', GS) >= 0;
}

/** 判断是否为续表（headers 不含发卡机构相关关键词） */
function isContinuation(ct: ContextTable): boolean {
  return !isCardHeader(ct);
}

/** 判断是否为误分类表格（如相关还款责任混入贷记卡桶） */
function isMisclassified(ct: ContextTable): boolean {
  const h = ct.table.headers;
  return h.some(v => v.includes('主业务借款人') || v.includes('个人经营性贷款'));
}

/** 从 headers 行 row[0] 提取开立日期（兼容粘连格式） */
function extractOpenDate(headers: string[], row0: string[]): string {
  // 粘连格式："开立日期账户授信额度" → 值为 "2016.06.21\n10000"，取日期部分
  const stickyIdx = findLabelGroup(headers, '开立日期账户授信额度', GS);
  if (stickyIdx >= 0) {
    const raw = getGroupValue(row0, stickyIdx, GS);
    const parts = raw.replace(/\\n/g, '\n').split('\n');
    const datePart = parts[0]?.trim() ?? '';
    if (/\d{4}[.\-/]\d{2}[.\-/]\d{2}/.test(datePart)) return datePart;
  }
  // 标准模式
  const idx = findLabelGroup(headers, '开立日期', GS);
  if (idx >= 0) return getGroupValue(row0, idx, GS);
  return '';
}

/** 从 headers 行 row[0] 提取授信额度（兼容粘连在开立日期中的情况） */
function extractCreditLimit(headers: string[], row0: string[]): number {
  // 检查 headers 是否存在"开立日期账户授信额度"粘连
  const hasStickyHeader = headers.some(h =>
    h.includes('开立日期') && h.includes('账户授信额度'),
  );
  if (hasStickyHeader) {
    // 粘连格式：值为 "2016.06.21\n10000"，取换行后的数字部分
    const stickyIdx = findLabelGroup(headers, '开立日期账户授信额度', GS);
    if (stickyIdx >= 0) {
      const raw = getGroupValue(row0, stickyIdx, GS);
      const parts = raw.replace(/\\n/g, '\n').split('\n');
      const numPart = parts.length > 1 ? parts[parts.length - 1] : parts[0];
      return parseNum(numPart);
    }
  }
  // 标准模式：headers 中有独立的"账户授信额度"
  const idx = findLabelGroup(headers, '账户授信额度', GS);
  if (idx >= 0) {
    const raw = getGroupValue(row0, idx, GS);
    return parseNum(cleanNumStr(raw));
  }
  return 0;
}

/** 从整张表扫描账户状态，兼容分栏、续表和 OCR 行号漂移。 */
function extractStatus(table: ParsedTable): string {
  const raw = findTableValueByLabels(table, ['账户状态', '户状态']);
  const status = cleanStatus(raw);
  if (status) return status;

  for (const row of [table.headers, ...table.rows]) {
    const rowStatus = cleanStatus(row.join(' '));
    if (rowStatus) return rowStatus;
  }
  return '';
}

/** 从整张表扫描已用额度，避免依赖固定 row[2]/row[3]。 */
function extractUsedAmount(table: ParsedTable): number | null {
  const raw = findTableValueByLabels(table, ['已用额度', '巳用额度'], 'amount');
  if (!raw) return null;
  return parseNum(cleanNumStr(raw));
}

function extractAccountId(table: ParsedTable): string {
  const direct = findTableValueByLabels(table, ['账户标识', '账户保识', '账户标R']);
  if (isLikelyAccountId(direct)) return direct;

  for (const cell of firstValueCells(table)) {
    const match = cell.match(/[A-Z][A-Z0-9][A-Z0-9\s.\-]{8,}/i);
    if (match) return match[0].trim();
  }
  return '';
}

function extractFallbackOrg(table: ParsedTable): string {
  for (const cell of firstValueCells(table)) {
    const org = cleanOrg(cell);
    if (isLikelyOrgValue(org)) return org;
  }
  return '';
}

function extractFallbackOpenDate(table: ParsedTable): string {
  for (const cell of firstValueCells(table)) {
    const match = cell.match(/\d{4}[.\-/年]\d{1,2}[.\-/月]\d{1,2}日?/);
    if (match) return match[0].replace(/年|月/g, '.').replace(/日/g, '');
  }
  return '';
}

function extractFallbackCreditLimit(table: ParsedTable): number {
  let best = 0;
  for (const cell of firstValueCells(table)) {
    if (/[A-Za-z]/.test(cell)) continue;
    if (/\d{4}[.\-/年]\d{1,2}[.\-/月]\d{1,2}/.test(cell)) continue;
    const match = cell.replace(/[￥¥元]/g, '').match(/\d[\d,.]*/);
    if (!match) continue;
    const amount = parseNum(match[0]);
    if (amount > best) best = amount;
  }
  return best;
}

function firstValueCells(table: ParsedTable): string[] {
  return [table.headers, ...table.rows.slice(0, 2)]
    .flat()
    .map((cell) => cell.trim())
    .filter(Boolean);
}

function isLikelyAccountId(value: string): boolean {
  if (/\d{4}[.\-/年]\d{1,2}[.\-/月]\d{1,2}/.test(value)) return false;
  return value.replace(/\s+/g, '').replace(/[^A-Za-z0-9]/g, '').length >= 8;
}

function isLikelyOrgValue(value: string): boolean {
  const normalized = value.replace(/\s+/g, '');
  if (normalized.length < 4) return false;
  if (/账户|日期|额度|币种|业务|担保|状态|账单|还款|记录|授信/.test(normalized)) return false;
  if (/^[A-Za-z0-9\s.,\-]+$/.test(value)) return false;
  if (/\d{4}[.\-/年]\d{1,2}[.\-/月]\d{1,2}/.test(value)) return false;
  return /银行|银|公司|股份|分行|支行|中心|金融|贷款|租赁/.test(normalized);
}

/** 从单张贷记卡账户表格提取 CreditCardAccount */
function extractFromTable(ct: ContextTable): CreditCardAccount {
  const { headers, rows } = ct.table;
  const row0 = rows[0] ?? [];
  const cardOrgGroup = findLabelGroup(headers, '卡机构', GS);

  const foundOrgRaw = findTableValueByLabels(ct.table, ['发卡机构', '卡机构', '机构']) ||
    (cardOrgGroup >= 0 ? getGroupValue(row0, cardOrgGroup, GS) : '');
  const fallbackOrg = extractFallbackOrg(ct.table);
  const foundOrg = cleanOrg(foundOrgRaw);
  const org = isLikelyOrgValue(foundOrg)
    ? foundOrg
    : (fallbackOrg || (isLikelyAccountId(foundOrg) ? '' : foundOrg));
  const openDate = findTableValueByLabels(ct.table, '开立日期', 'date') ||
    extractOpenDate(headers, row0) ||
    extractFallbackOpenDate(ct.table);
  const creditLimitRaw = findTableValueByLabels(ct.table, '账户授信额度', 'amount');
  let creditLimit = creditLimitRaw
    ? parseNum(creditLimitRaw)
    : extractCreditLimit(headers, row0) || extractFallbackCreditLimit(ct.table);
  const fallbackCreditLimit = extractFallbackCreditLimit(ct.table);
  if (creditLimit > 0 && creditLimit < 100 && fallbackCreditLimit > creditLimit) {
    creditLimit = fallbackCreditLimit;
  }
  const status = extractStatus(ct.table);
  const isClosed = /结清|销户|未激活/.test(status);
  const usedAmount = isClosed ? null : extractUsedAmount(ct.table);
  const billDate = isClosed ? null : findTableValueByLabels(ct.table, '账单日', 'date') || null;
  const monthlyPaymentRaw = isClosed ? '' :
    findTableValueByLabels(ct.table, ['本月应还款', '本月应还', '应还款额', '本期应还'], 'amount');
  const actualPaymentRaw = isClosed ? '' : findTableValueByLabels(ct.table, '本月实还款', 'amount');
  const currentOverdueCountRaw = isClosed ? '' : findTableValueByLabels(ct.table, '当前逾期期数', 'amount');
  const currentOverdueAmountRaw = isClosed ? '' : findTableValueByLabels(ct.table, '当前逾期总额', 'amount');
  const sharedCreditLimitRaw = findTableValueByLabels(ct.table, '共享授信额度', 'amount');

  return {
    org,
    accountId: extractAccountId(ct.table),
    openDate,
    creditLimit,
    sharedCreditLimit: sharedCreditLimitRaw ? parseNum(sharedCreditLimitRaw) : null,
    currency: findTableValueByLabels(ct.table, '币种'),
    businessType: findTableValueByLabels(ct.table, '业务种类'),
    guaranteeType: findTableValueByLabels(ct.table, '担保方式'),
    status,
    balance: null,
    usedAmount,
    unpostedLargeAmount: null,
    remainInstallments: null,
    avgUsed6m: null,
    maxUsed: null,
    billDate,
    monthlyPayment: monthlyPaymentRaw ? parseNum(monthlyPaymentRaw) : null,
    actualPayment: actualPaymentRaw ? parseNum(actualPaymentRaw) : null,
    lastPaymentDate: isClosed ? null : findTableValueByLabels(ct.table, '最近一次还款日期', 'date') || null,
    currentOverdueCount: currentOverdueCountRaw ? parseNum(currentOverdueCountRaw) : null,
    currentOverdueAmount: currentOverdueAmountRaw ? parseNum(currentOverdueAmountRaw) : null,
    largeInstallmentInfo: null,
    specialTransactions: [],
    repaymentRecords: parseRepaymentRecords(rows),
    dataSource: null,
  };
}

/** 从分组后的贷记卡表格提取所有账户，跳过续表和误分类表格，处理分栏截断 */
export function parseCreditCards(tables: ContextTable[]): CreditCardAccount[] {
  const accounts: CreditCardAccount[] = [];
  let idx = 0;
  while (idx < tables.length) {
    const ct = tables[idx];
    if (isMisclassified(ct)) { idx++; continue; }
    if (isContinuation(ct)) { idx++; continue; }

    const split = tryMergeSplitTable(tables, idx, t => isCardHeader(t), 2);
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

export function parseCreditCardSegments(segments: AccountSegment[]): CreditCardAccount[] {
  const accounts: CreditCardAccount[] = [];
  for (const segment of segments) {
    const standalone = parseCreditCards(segment.tables).filter(hasUsableCreditCardFields);
    if (standalone.length > 1) {
      accounts.push(...standalone);
      continue;
    }

    const merged = mergeSegmentTablesForParsing(segment.tables);
    if (merged) {
      const account = extractFromTable(merged);
      if (hasUsableCreditCardFields(account)) {
        accounts.push(account);
        continue;
      }
    }

    if (standalone[0]) accounts.push(standalone[0]);
  }
  return accounts;
}

function hasUsableCreditCardFields(account: CreditCardAccount): boolean {
  if (!account.org.trim() && !isLikelyAccountId(account.accountId)) return false;
  return account.creditLimit > 0 ||
    (account.usedAmount ?? 0) > 0 ||
    Boolean(account.status.trim());
}
