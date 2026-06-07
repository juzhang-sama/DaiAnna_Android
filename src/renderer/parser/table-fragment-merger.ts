/**
 * 表格片段合并层
 *
 * OCR 可能把同一张征信表按分栏或分页拆成多个 table block。
 * 这里在分类前按阅读顺序合并高置信度片段，避免各业务 parser 重复猜续表。
 */

import type { ContextTable } from './doc-table-bridge';
import type { ParsedTable } from './markdown-table-parser';

const SAME_ROW_Y_TOLERANCE = 24;
const MAX_CONTINUATION_PAGE_GAP = 1;

const ACCOUNT_ENTRY_PATTERN = /[账戶户]户?\d+/;
const AGREEMENT_ENTRY_PATTERN = /授信协议\d+/;

const PRIMARY_HEADER_KEYWORDS = [
  '管理机构',
  '发卡机构',
  '查询日期',
  '授信协议标识',
  '还款责任金额',
  '主业务借款人',
  '证件号码',
];

/**
 * 合并相邻表格片段。
 * 输入必须已经是稳定阅读顺序；输出仍保持该顺序。
 */
export function mergeTableFragments(tables: ContextTable[]): ContextTable[] {
  const merged: ContextTable[] = [];
  let idx = 0;

  while (idx < tables.length) {
    let current = tables[idx];
    let consumed = 1;

    while (idx + consumed < tables.length) {
      const next = tables[idx + consumed];
      const combined = tryMergeAdjacent(current, next);
      if (!combined) break;

      current = combined;
      consumed++;
    }

    merged.push(current);
    idx += consumed;
  }

  return merged;
}

function tryMergeAdjacent(base: ContextTable, next: ContextTable): ContextTable | null {
  if (!isReadingNeighbor(base, next)) return null;
  if (!isCompatibleContext(base, next)) return null;
  if (isDifferentEntry(base, next)) return null;

  if (isHorizontalSplit(base, next)) {
    return mergeHorizontal(base, next);
  }

  if (isVerticalContinuation(base, next)) {
    return mergeVertical(base, next);
  }

  return null;
}

function isReadingNeighbor(base: ContextTable, next: ContextTable): boolean {
  const pageGap = next.logicalPage - base.logicalPage;
  if (pageGap < 0 || pageGap > MAX_CONTINUATION_PAGE_GAP) return false;

  if (pageGap === 0 && next.positionY + SAME_ROW_Y_TOLERANCE < base.positionY) {
    return false;
  }

  return true;
}

function isCompatibleContext(base: ContextTable, next: ContextTable): boolean {
  const baseText = normalizeContext(base.precedingText);
  const nextText = normalizeContext(next.precedingText);
  if (!nextText) return true;
  if (baseText && baseText === nextText) return true;

  const baseEntry = extractEntryLabel(baseText);
  const nextEntry = extractEntryLabel(nextText);
  return Boolean(baseEntry && nextEntry && baseEntry === nextEntry);
}

function isDifferentEntry(base: ContextTable, next: ContextTable): boolean {
  const baseEntry = extractEntryLabel(base.precedingText);
  const nextEntry = extractEntryLabel(next.precedingText);
  if (!nextEntry) return false;
  if (!baseEntry) return normalizeContext(base.precedingText) !== normalizeContext(next.precedingText);
  return baseEntry !== nextEntry;
}

function extractEntryLabel(text: string): string | null {
  const account = text.match(ACCOUNT_ENTRY_PATTERN)?.[0];
  if (account) return account;
  return text.match(AGREEMENT_ENTRY_PATTERN)?.[0] ?? null;
}

function normalizeContext(text: string): string {
  return text.replace(/\s+/g, '').trim();
}

function isHorizontalSplit(base: ContextTable, next: ContextTable): boolean {
  if (base.logicalPage !== next.logicalPage) return false;
  if (Math.abs(base.positionY - next.positionY) > SAME_ROW_Y_TOLERANCE) return false;
  if (next.positionX <= base.positionX) return false;
  if (sameHeaders(base.table, next.table)) return false;

  const baseRows = toAllRows(base.table);
  const nextRows = toAllRows(next.table);
  if (baseRows.length < 2 || baseRows.length !== nextRows.length) return false;

  return true;
}

function isVerticalContinuation(base: ContextTable, next: ContextTable): boolean {
  if (isSameVisualRow(base, next)) return false;
  if (sameHeaders(base.table, next.table)) {
    // 账户明细每个账户通常都有相同表头；完整账户表不能因为表头一致被合并。
    if (isAccountDetailTable(base.table) || isAccountDetailTable(next.table)) {
      return false;
    }
    return hasContinuationEvidence(base, next);
  }
  if (isIncompleteStructuredTable(base)) {
    return !hasPrimaryHeader(next.table);
  }

  // TextIn 标记存在时，只作为连续上下文下的加强证据，不单独决定合并。
  if (base.mergeTableHint || next.mergeTableHint) {
    return !hasPrimaryHeader(next.table);
  }

  return false;
}

function isSameVisualRow(base: ContextTable, next: ContextTable): boolean {
  return base.logicalPage === next.logicalPage &&
    Math.abs(base.positionY - next.positionY) <= SAME_ROW_Y_TOLERANCE;
}

function isIncompleteStructuredTable(table: ContextTable): boolean {
  if (table.table.rows.length === 0) return true;

  const minRows = expectedMinimumRows(table.table);
  return minRows > 0 && table.table.rows.length < minRows;
}

function expectedMinimumRows(table: ParsedTable): number {
  const headerText = table.headers.join(' ');
  if (headerText.includes('借款金额')) return 3;
  if (headerText.includes('账户授信额度')) return 2;
  if (headerText.includes('发卡机构') || headerText.includes('卡机构')) return 2;
  if (headerText.includes('授信协议标识') || headerText.includes('授信额度用途')) return 2;
  if (headerText.includes('还款责任金额') || headerText.includes('责任人类型')) return 1;
  return 0;
}

function hasContinuationEvidence(base: ContextTable, next: ContextTable): boolean {
  return Boolean(base.mergeTableHint || next.mergeTableHint || !normalizeContext(next.precedingText));
}

function isAccountDetailTable(table: ParsedTable): boolean {
  const text = table.headers.join(' ');
  return (text.includes('管理机构') && text.includes('借款金额')) ||
    text.includes('账户授信额度') ||
    text.includes('发卡机构') ||
    text.includes('卡机构');
}

function hasPrimaryHeader(table: ParsedTable): boolean {
  const text = table.headers.join(' ');
  return PRIMARY_HEADER_KEYWORDS.some((keyword) => text.includes(keyword));
}

function sameHeaders(a: ParsedTable, b: ParsedTable): boolean {
  return normalizeRow(a.headers) === normalizeRow(b.headers);
}

function normalizeRow(row: string[]): string {
  return row.map((cell) => cell.replace(/\s+/g, '')).join('|');
}

function mergeHorizontal(base: ContextTable, next: ContextTable): ContextTable {
  const baseRows = toAllRows(base.table);
  const nextRows = toAllRows(next.table);
  const allRows = baseRows.map((row, index) => [...row, ...nextRows[index]]);
  return withMergedTable(base, next, {
    headers: allRows[0] ?? [],
    rows: allRows.slice(1),
  }, 'horizontal');
}

function mergeVertical(base: ContextTable, next: ContextTable): ContextTable {
  const rowsToAppend = sameHeaders(base.table, next.table)
    ? next.table.rows
    : [next.table.headers, ...next.table.rows];

  return withMergedTable(base, next, {
    headers: base.table.headers,
    rows: [...base.table.rows, ...rowsToAppend],
  }, 'vertical');
}

function withMergedTable(
  base: ContextTable,
  next: ContextTable,
  table: ParsedTable,
  strategy: 'horizontal' | 'vertical',
): ContextTable {
  return {
    ...base,
    table,
    precedingText: base.precedingText || next.precedingText,
    markdown: tableToMarkdown(table),
    fragmentCount: (base.fragmentCount ?? 1) + (next.fragmentCount ?? 1),
    fragmentMergeStrategy: strategy,
  };
}

function toAllRows(table: ParsedTable): string[][] {
  return [table.headers, ...table.rows];
}

function tableToMarkdown(table: ParsedTable): string {
  const rows = [table.headers, ...table.rows];
  const separator = table.headers.map(() => '---');
  return [table.headers, separator, ...table.rows]
    .filter((row) => row.length > 0)
    .map((row) => `| ${row.join(' | ')} |`)
    .join('\n') || rows.map((row) => row.join('\t')).join('\n');
}
