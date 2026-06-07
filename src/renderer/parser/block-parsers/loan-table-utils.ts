/**
 * 贷款类账户表格解析共享工具函数
 *
 * 被 non-revolving-loan-parser 和 revolving-loan1-parser 共用
 */

import type { ContextTable } from '../doc-table-bridge';
import type { ParsedTable } from '../markdown-table-parser';
import type { RepaymentRecord } from '../../types/credit-report';

/** 取一组内第一个非空值 */
export function getGroupValue(row: string[], groupStart: number, groupSize: number): string {
  for (let i = groupStart; i < groupStart + groupSize && i < row.length; i++) {
    const v = row[i]?.trim();
    if (v) return v;
  }
  return '';
}

/** 在标签行中模糊匹配关键词，返回所在组的起始索引 */
export function findLabelGroup(labelRow: string[], keyword: string, groupSize: number): number {
  for (let i = 0; i < labelRow.length; i++) {
    if (matchesLabel(labelRow[i] ?? '', keyword)) {
      return Math.floor(i / groupSize) * groupSize;
    }
  }
  return -1;
}

/** 从标签行+值行中按关键词提取值 */
export function getLabeledValue(
  labelRow: string[], valueRow: string[], keyword: string, groupSize: number,
): string {
  const group = findLabelGroup(labelRow, keyword, groupSize);
  if (group < 0) return '';
  return getGroupValue(valueRow, group, groupSize);
}

function matchesLabel(cell: string, keyword: string): boolean {
  if (!cell) return false;

  const value = normalizeLabelCell(cell);
  const target = normalizeLabelCell(keyword);
  if (!value || !target) return false;
  if (hasConflictingLabelMeaning(value, target)) return false;
  if (value.includes(target)) return true;
  if (target.includes(value) && target.length - value.length <= 1 && value.length >= Math.min(3, target.length)) {
    return true;
  }

  if (target === '管理机构' && value.includes('查询机构')) return false;
  if (target.length <= 2) return false;

  return labelSimilarity(value, target) >= similarityThreshold(target);
}

function hasConflictingLabelMeaning(value: string, target: string): boolean {
  const exclusivePairs: Array<[string, string]> = [
    ['证件类型', '证件号码'],
    ['开立日期', '到期日期'],
    ['本月应还款', '本月实还款'],
    ['查询机构', '管理机构'],
  ];

  return exclusivePairs.some(([left, right]) =>
    (value.includes(left) && target.includes(right)) ||
    (value.includes(right) && target.includes(left)),
  );
}

function normalizeLabelCell(value: string): string {
  return value
    .replace(/\s+/g, '')
    .replace(/[■□�]/g, '')
    .replace(/[：:()（）]/g, '')
    .replace(/僧款/g, '借款')
    .replace(/管利/g, '管理')
    .replace(/管机/g, '管理机')
    .replace(/到日期/g, '到期日期')
    .replace(/期日期/g, '到期日期')
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');
}

function labelSimilarity(value: string, target: string): number {
  const lcs = longestCommonSubsequence(value, target);
  return lcs / Math.max(value.length, target.length);
}

function similarityThreshold(target: string): number {
  if (target.length <= 4) return 0.74;
  if (target.length <= 6) return 0.68;
  return 0.62;
}

function longestCommonSubsequence(a: string, b: string): number {
  const prev = new Array(b.length + 1).fill(0);
  const curr = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    curr.fill(0);
    for (let j = 1; j <= b.length; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1] + 1
        : Math.max(prev[j], curr[j - 1]);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

export type TableValueKind = 'text' | 'amount' | 'date';

/**
 * 在整张账户表中按标签找值。
 *
 * TextIn 表格常见形态不是固定的 row[4]/row[5]：
 * - 标签在 headers，值在第一行；
 * - 标签和值上下两行；
 * - 合并单元格导致标签重复填充；
 * - OCR 把标签和值粘在同一个单元格。
 */
export function findTableValueByLabels(
  table: ParsedTable,
  labels: string | string[],
  kind: TableValueKind = 'text',
): string {
  return findValueByLabelsInRows([table.headers, ...table.rows], labels, kind);
}

export function findValueByLabelsInRows(
  allRows: string[][],
  labels: string | string[],
  kind: TableValueKind = 'text',
): string {
  const labelList = Array.isArray(labels) ? labels : [labels];
  for (let rowIdx = 0; rowIdx < allRows.length; rowIdx++) {
    const row = allRows[rowIdx] ?? [];
    for (let colIdx = 0; colIdx < row.length; colIdx++) {
      const cell = row[colIdx] ?? '';
      if (!labelList.some((label) => matchesLabel(cell, label))) continue;

      const candidates = collectValueCandidates(allRows, rowIdx, colIdx, labelList);
      for (const candidate of candidates) {
        const value = normalizeTableCandidate(candidate, labelList, kind);
        if (value) return value;
      }
    }
  }
  return '';
}

function collectValueCandidates(
  allRows: string[][],
  rowIdx: number,
  colIdx: number,
  labels: string[],
): string[] {
  const row = allRows[rowIdx] ?? [];
  const nextRow = allRows[rowIdx + 1] ?? [];
  const candidates: string[] = [];

  candidates.push(extractInlineValue(row[colIdx] ?? '', labels));
  candidates.push(row[colIdx + 1] ?? '');
  candidates.push(row[colIdx + 2] ?? '');

  for (let offset = 0; offset <= 2; offset++) {
    candidates.push(nextRow[colIdx + offset] ?? '');
  }

  return candidates;
}

function extractInlineValue(cell: string, labels: string[]): string {
  for (const label of labels) {
    const idx = cell.indexOf(label);
    if (idx < 0) continue;
    const after = cell.slice(idx + label.length).replace(/^[：:\s\-]+/, '').trim();
    if (after) return after;
  }
  return '';
}

function normalizeTableCandidate(raw: string, labels: string[], kind: TableValueKind): string {
  if (!raw) return '';
  for (const line of splitLines(raw)) {
    const inline = extractInlineValue(line, labels);
    const candidate = inline || line.trim();
    if (!candidate) continue;
    if (labels.some((label) => candidate === label || candidate.includes(label))) continue;

    if (kind === 'amount') {
      if (isLabelLike(candidate)) continue;
      const amount = extractAmountCandidate(candidate);
      if (amount) return amount;
      continue;
    }
    if (kind === 'date') {
      const date = extractDateCandidate(candidate);
      if (date) return date;
      continue;
    }
    if (!isLabelLike(candidate)) return candidate;
  }
  return '';
}

function extractAmountCandidate(raw: string): string {
  const text = raw.trim().replace(/[￥¥元]/g, '');
  if (!text || looksLikeDate(text)) return '';
  if (/^[-—－]+$/.test(text)) return '0';
  const match = text.match(/-?\d[\d,.]*/);
  if (!match) return '';
  const value = match[0];
  if (looksLikeDate(value)) return '';
  return value;
}

function extractDateCandidate(raw: string): string {
  const text = raw.trim();
  const date = text.match(/\d{4}[.\-/年]\d{1,2}[.\-/月]\d{1,2}日?/);
  if (date) return date[0].replace(/年|月/g, '.').replace(/日/g, '');
  const day = text.match(/^(?:[1-9]|[12]\d|3[01])$/);
  return day?.[0] ?? '';
}

function looksLikeDate(value: string): boolean {
  return /\d{4}[.\-/年]\d{1,2}[.\-/月]\d{1,2}日?/.test(value) ||
    /\d{4}\s*年/.test(value);
}

function isLabelLike(value: string): boolean {
  const isNumeric = /^[-—－\d,.\s￥¥元]+$/.test(value);
  if (isNumeric) return false;
  return /机构|种类|方式|状态|额度|余额|日期|还款|期数|分类|币种|账户|金额|借款|利率|标识|合同|到期|开立|证件|编号|授信|账单/.test(value);
}

/** 解析数字，先清洗换行粘连再去除千分位分隔符 */
export function parseNum(s: string): number {
  // 先去掉 \n 后面的中文（如 "150,000\n人民币元" → "150,000"）
  let cleaned = cleanNumStr(s);
  cleaned = cleaned.replace(/,/g, '').trim();
  // OCR 可能将千分位逗号识别为小数点，如 "9.000" 实为 9000
  cleaned = cleaned.replace(/\.(\d{3})(?!\d)/g, '$1');
  const n = Number(cleaned);
  return isNaN(n) ? 0 : n;
}

/** 判断是否为续表（非新账户表格），sectionPrefix 用于匹配章节首表 */
export function isContinuationTable(ct: ContextTable, sectionPrefix: RegExp): boolean {
  return !/[账戶户]户?\d+/.test(ct.precedingText) && !sectionPrefix.test(ct.precedingText);
}

/** 判断表格是否有标准贷管理机构） */
export function hasLoanHeader(ct: ContextTable): boolean {
  return findLabelGroup(ct.table.headers, '管理机构', 1) >= 0;
}

/**
 * 检测分栏截断表：有标准表头但数据行不足（rows < minRows）
 * 当检测到时，将当前表头与下一张续表合并为完整 ContextTable
 *
 * 续表结构：headers 实际是原表的第一行数据值，rows 是剩余数据行
 * 合并策略：当前表 headers + [续表 headers（作为首行数据）, ...续表 rows]
 */
export function tryMergeSplitTable(
  tables: ContextTable[], idx: number, isHeader: (ct: ContextTable) => boolean, minRows: number,
): { merged: ContextTable; skip: number } | null {
  const ct = tables[idx];
  if (ct.table.rows.length >= minRows) return null;
  const next = tables[idx + 1];
  if (!next || isHeader(next)) return null;
  // 续表的 headers 是被截断的第一行数据，拼回 rows 前面
  const mergedRows = [next.table.headers, ...next.table.rows];
  // 再把原表已有的 rows（如果有的话）也放在最前面
  const allRows = [...ct.table.rows, ...mergedRows];
  const merged: ContextTable = {
    ...ct,
    table: { headers: ct.table.headers, rows: allRows },
  };
  return { merged, skip: 2 };
}

/**
 * 将同一账户段内的表格片段合并为一个解析视图。
 *
 * 账户边界由 doc-table-bridge 根据“类别标题 + 账户N + 阅读顺序”确定；
 * 到这里时，同段内的表格都应视为同一账户的字段来源。合并时优先横向拼接
 * 行数一致的左右半表，其余片段按阅读顺序追加，方便按标签全表搜索。
 */
export function mergeSegmentTablesForParsing(tables: ContextTable[]): ContextTable | null {
  if (tables.length === 0) return null;
  let current = cloneContextTable(tables[0]);

  for (const next of tables.slice(1)) {
    current = canMergeHorizontally(current.table, next.table)
      ? mergeContextTables(current, next, mergeParsedTablesHorizontally(current.table, next.table), 'horizontal')
      : mergeContextTables(current, next, mergeParsedTablesVertically(current.table, next.table), 'vertical');
  }

  return current;
}

function cloneContextTable(table: ContextTable): ContextTable {
  return {
    ...table,
    table: {
      headers: [...table.table.headers],
      rows: table.table.rows.map((row) => [...row]),
    },
  };
}

function canMergeHorizontally(a: ParsedTable, b: ParsedTable): boolean {
  const aRows = [a.headers, ...a.rows];
  const bRows = [b.headers, ...b.rows];
  if (aRows.length < 2 || aRows.length !== bRows.length) return false;
  if (normalizeHeaderRow(a.headers) === normalizeHeaderRow(b.headers)) return false;
  return true;
}

function mergeParsedTablesHorizontally(a: ParsedTable, b: ParsedTable): ParsedTable {
  const aRows = [a.headers, ...a.rows];
  const bRows = [b.headers, ...b.rows];
  const mergedRows = aRows.map((row, index) => [...row, ...(bRows[index] ?? [])]);
  return {
    headers: mergedRows[0] ?? [],
    rows: mergedRows.slice(1),
  };
}

function mergeParsedTablesVertically(a: ParsedTable, b: ParsedTable): ParsedTable {
  const rowsToAppend = normalizeHeaderRow(a.headers) === normalizeHeaderRow(b.headers)
    ? b.rows
    : [b.headers, ...b.rows];
  return {
    headers: a.headers,
    rows: [...a.rows, ...rowsToAppend],
  };
}

function mergeContextTables(
  base: ContextTable,
  next: ContextTable,
  table: ParsedTable,
  strategy: 'horizontal' | 'vertical',
): ContextTable {
  return {
    ...base,
    table,
    markdown: tableToMarkdown(table),
    precedingText: base.precedingText || next.precedingText,
    fragmentCount: (base.fragmentCount ?? 1) + (next.fragmentCount ?? 1),
    fragmentMergeStrategy: strategy,
  };
}

function normalizeHeaderRow(row: string[]): string {
  return row.map((cell) => cell.replace(/\s+/g, '')).join('|');
}

function tableToMarkdown(table: ParsedTable): string {
  const separator = table.headers.map(() => '---');
  return [table.headers, separator, ...table.rows]
    .filter((row) => row.length > 0)
    .map((row) => `| ${row.join(' | ')} |`)
    .join('\n');
}

// ── OCR 粘连清洗函数 ──

/** 按真正换行符和字面量 \n 两种模式分割（OCR 结果可能是任一种） */
function splitLines(s: string): string[] {
  return s.replace(/\\n/g, '\n').split('\n');
}

const ORG_SUFFIXES = ['公司', '银行', '中心', '合作社'];

/**
 * 清洗管理机构名称
 * 处理粘连模式：
 * - "N10156530\n重庆美团三快小...贷款有限公司3054..." → "重庆美团三快小额贷款有限公司"
 * - "深圳市中融小额贷X4403...款有限公司2022.09.11..." → "深圳市中融小额贷款有限公司"
 */
export function cleanOrg(raw: string): string {
  if (!raw) return '';
  // 多行时逐行找含机构后缀的行
  const lines = splitLines(raw);
  if (lines.length > 1) {
    for (const line of lines) {
      if (ORG_SUFFIXES.some(s => line.includes(s))) {
        return cleanOrg(line);
      }
    }
  }
  // 单行：截取到最后一个机构后缀
  for (const suffix of ORG_SUFFIXES) {
    const idx = raw.lastIndexOf(suffix);
    if (idx >= 0) {
      let org = raw.slice(0, idx + suffix.length);
      // 去掉混入的数字串（如 "小额贷X4403...款有限公司" 中间的杂质）
      org = org.replace(/[A-Za-z0-9]{6,}/g, '');
      // 去掉残留的标点
      org = org.replace(/[；;，,。.]/g, '');
      return org;
    }
  }
  return raw;
}

/**
 * 清洗账户状态
 * 处理粘连模式：
 * - "正常正常46,200" → "正常"
 * - "结清2025.06.17" → "结清"
 * - "正常" → "正常"
 */
const STATUS_KEYWORDS = ['正常', '结清', '销户', '呆账', '呆帐', '逾期', '冻结', '止付'];

export function cleanStatus(raw: string): string {
  if (!raw) return '';
  // 匹配文本中最早出现的关键词，而非数组顺序
  let bestKw = '';
  let bestIdx = Infinity;
  for (const kw of STATUS_KEYWORDS) {
    const idx = raw.indexOf(kw);
    if (idx >= 0 && idx < bestIdx) {
      bestIdx = idx;
      bestKw = kw;
    }
  }
  return bestKw;
}

/**
 * 清洗含换行的数值字段
 * 处理粘连模式："26,400\n人民币元" → "26,400"
 */
export function cleanNumStr(raw: string): string {
  if (!raw) return '';
  const first = splitLines(raw)[0].trim();
  return first;
}

/** 从账户表格中提取还款记录，识别形态：年份 + 12个月状态码 */
export function parseRepaymentRecords(rows: string[][]): RepaymentRecord[] {
  const records: RepaymentRecord[] = [];

  for (const row of rows) {
    const yearIdx = row.findIndex((cell) => /^20\d{2}$/.test(cell.trim()));
    if (yearIdx < 0) continue;

    const year = parseInt(row[yearIdx], 10);
    const statuses = row
      .slice(yearIdx + 1)
      .map(cleanStatusCode)
      .filter((code): code is string => code !== null)
      .slice(0, 12);

    if (statuses.length < 6) continue;

    records.push({
      year,
      months: Array.from({ length: 12 }, (_, i) => statuses[i] ?? null),
    });
  }

  return records;
}

function cleanStatusCode(raw: string): string | null {
  const code = raw.trim().replace(/\s/g, '');
  if (!code) return null;
  if (/^[1-7]$/.test(code)) return code;
  if (/^(N|C|D|G|Z|\*|\/|#)$/.test(code)) return code;
  return null;
}
