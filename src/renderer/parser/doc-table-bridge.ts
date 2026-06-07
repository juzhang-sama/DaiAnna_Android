/**
 * 文档解析结果桥接层 — 从 DocParserResult 提取所有 Markdown 表格
 *
 * 将 TextIn 适配层返回的结构化数据转为 ParsedTable 数组，
 * 供各 block parser 按关键词搜索表格并提取值
 */

import type { DocLayout, DocPage, DocParserResult } from '../../shared/doc-parser-types';
import { parseMarkdownTable, type ParsedTable } from './markdown-table-parser';
import { getLevel1Map } from './section-locator';
import { getLayoutLogicalPage } from './reading-order';
import { mergeTableFragments } from './table-fragment-merger';
import { debugLog } from '../utils/debug-log';

/** 带上下文的表格：包含所在页码和前后文本 */
export interface ContextTable {
  table: ParsedTable;
  /** 物理页码（PDF 页） */
  pageNum: number;
  /** 逻辑页码（征信报告页，考虑左右双栏） */
  logicalPage: number;
  /** 表格 y 坐标（用于同一逻辑页内的排序） */
  positionY: number;
  /** 表格 x 坐标（用于同一逻辑页内的稳定排序和溯源） */
  positionX: number;
  /** 表格同栏同逻辑页上方最近的文本元素（用于定位区块） */
  precedingText: string;
  /** 原始 markdown */
  markdown: string;
  /** TextIn 跨页表格提示：begin / inner / end / 空 */
  mergeTableHint?: string;
  /** 合并后的片段数量；未合并时为空 */
  fragmentCount?: number;
  /** 合并策略：纵向续表或横向分割 */
  fragmentMergeStrategy?: 'vertical' | 'horizontal';
}

/**
 * 从文档解析结果中提取所有表格，附带上下文信息
 * 同时初始化章节页码映射缓存（从 layouts 中扫描章节标题）
 */
export function extractTablesFromDoc(doc: DocParserResult): ContextTable[] {
  const result: Array<ContextTable & { sourceIndex: number }> = [];

  // 缓存 doc 供溯源时扫描 layouts
  setCachedDocResult(doc);

  // 先扫描 layouts 构建章节页码映射（必须在提取表格前完成）
  buildSectionPageMapFromDoc(doc);

  for (const page of doc.pages) {
    for (let i = 0; i < page.layouts.length; i++) {
      const layout = page.layouts[i];
      if (layout.type !== 'table') continue;

      const tableData = page.tables.find((t) => t.layout_id === layout.layout_id);
      if (!tableData?.markdown) continue;

      const parsed = parseMarkdownTable(tableData.markdown);
      if (parsed.headers.length === 0) continue;

      const logicalPage = getLayoutLogicalPage(page, layout);

      // 找同栏同逻辑页、表格上方最近的文本作为上下文。
      const preceding = findPrecedingText(page, layout, logicalPage);

      result.push({
        table: parsed,
        pageNum: page.page_num,
        logicalPage,
        positionY: layout.position[1],
        positionX: layout.position[0],
        precedingText: preceding,
        markdown: tableData.markdown,
        mergeTableHint: tableData.merge_table,
        sourceIndex: result.length,
      });
    }
  }

  const sorted = result
    .sort(compareTablesByReadingOrder)
    .map(({ sourceIndex, ...table }) => table);

  return mergeTableFragments(sorted);
}

/** 找到当前表格同栏同逻辑页上方最近的文本元素 */
function findPrecedingText(
  page: DocPage, tableLayout: DocLayout, tableLogicalPage: number,
): string {
  const tableY = tableLayout.position[1];
  let best: { text: string; y: number; x: number } | null = null;

  for (const layout of page.layouts) {
    if (layout.type === 'table' || !layout.text?.trim()) continue;
    if (layout.sub_type === 'footer' || layout.type === 'head_tail') continue;
    if (getLayoutLogicalPage(page, layout) !== tableLogicalPage) continue;
    const y = layout.position[1];
    if (y > tableY) continue;

    if (!best || y > best.y || (y === best.y && layout.position[0] > best.x)) {
      best = { text: layout.text, y, x: layout.position[0] };
    }
  }

  return best?.text ?? '';
}

function compareTablesByReadingOrder(
  a: ContextTable & { sourceIndex: number },
  b: ContextTable & { sourceIndex: number },
): number {
  return a.logicalPage - b.logicalPage ||
    a.positionY - b.positionY ||
    a.positionX - b.positionX ||
    a.sourceIndex - b.sourceIndex;
}

/**
 * 在表格列表中查找包含指定关键词的表格
 * 搜索范围：表头、数据行第一列、前置文本
 */
export function findTableByKeyword(
  tables: ContextTable[], keyword: string,
): ContextTable | undefined {
  // 优先在前置文本中找
  for (const ct of tables) {
    if (ct.precedingText.includes(keyword)) return ct;
  }
  // 其次在表头中找
  for (const ct of tables) {
    if (ct.table.headers.some((h) => h.includes(keyword))) return ct;
  }
  // 最后在数据行第一列找
  for (const ct of tables) {
    for (const row of ct.table.rows) {
      if (row[0]?.includes(keyword)) return ct;
    }
  }
  return undefined;
}

/**
 * 查找所有包含指定关键词的表格
 */
export function findAllTablesByKeyword(
  tables: ContextTable[], keyword: string,
): ContextTable[] {
  return tables.filter((ct) =>
    ct.precedingText.includes(keyword) ||
    ct.table.headers.some((h) => h.includes(keyword)) ||
    ct.markdown.includes(keyword),
  );
}

/** 账户类型键（信贷交易信息明细下的6个二级模块） */
export type AccountCategory =
  | 'nonRevolvingLoan'    // (一) 非循环贷账户
  | 'revolvingLoan1'      // (二) 循环贷账户一
  | 'revolvingLoan2'      // (三) 循环贷账户二
  | 'creditCard'          // (四) 贷记卡账户
  | 'repayResponsibility' // (五) 相关还款责任信息
  | 'creditAgreement';    // (六) 授信协议信息

/** 章节标题关键词 → 账户类型映射 */
const SECTION_KEYWORDS: [string, AccountCategory][] = [
  ['非循环贷账户', 'nonRevolvingLoan'],
  ['循环贷账户一', 'revolvingLoan1'],
  ['循环贷账户二', 'revolvingLoan2'],
  ['贷记卡账户', 'creditCard'],
  ['相关还款责任信息', 'repayResponsibility'],
  ['授信协议信息', 'creditAgreement'],
];

/** 章节位置信息：逻辑页码 + y 坐标 */
interface SectionPosition {
  logicalPage: number;
  positionY: number;
}

interface ReadingEvent {
  kind: 'category' | 'account' | 'stop' | 'table';
  logicalPage: number;
  positionY: number;
  positionX: number;
  sourceIndex: number;
  category?: AccountCategory;
  accountLabel?: string;
  table?: ContextTable;
}

export interface AccountSegment {
  category: AccountCategory;
  accountLabel: string;
  tables: ContextTable[];
  logicalPage: number;
  positionY: number;
  positionX: number;
  index: number;
  source: 'anchor' | 'inferred';
}

export type AccountSegmentMap = Record<AccountCategory, AccountSegment[]>;

/** 缓存：从 DocParserResult 扫描得到的章节位置映射 */
let cachedSectionPageMap: Map<AccountCategory, SectionPosition> | null = null;

/**
 * 从 DocParserResult 的 layouts 中扫描章节标题，提取各章节首次出现的逻辑页码和 y 坐标
 * 必须在 extractTablesFromDoc() 中调用以初始化缓存
 */
export function buildSectionPageMapFromDoc(doc: DocParserResult): Map<AccountCategory, SectionPosition> {
  const map = new Map<AccountCategory, SectionPosition>();

  for (const page of doc.pages) {
    for (const layout of page.layouts) {
      if (layout.type === 'table') continue; // 跳过表格，只看文本
      const text = layout.text?.trim() ?? '';

      for (const [keyword, category] of SECTION_KEYWORDS) {
        if (text.includes(keyword)) {
          const next = {
            logicalPage: getLayoutLogicalPage(page, layout),
            positionY: layout.position[1],
          };
          const current = map.get(category);
          if (!current || compareSectionPosition(next, current) < 0) {
            map.set(category, next);
          }
        }
      }
    }
  }

  cachedSectionPageMap = map;
  return map;
}

function compareSectionPosition(a: SectionPosition, b: SectionPosition): number {
  return a.logicalPage - b.logicalPage || a.positionY - b.positionY;
}

/** 获取缓存的章节位置映射 */
function getSectionPageMap(): Map<AccountCategory, SectionPosition> {
  return cachedSectionPageMap ?? new Map();
}

/**
 * 根据逻辑页码和 y 坐标判断账户所属类别
 * 同一逻辑页内，用 y 坐标区分章节标题前后的表格
 *
 * 排序规则：先按 logicalPage 从大到小，同页再按 positionY 从大到小
 * 这样同页多章节时，y 值大的章节先被检查，避免被 y 值小的章节"截胡"
 */
function categorizeByPosition(
  logicalPage: number, positionY: number,
  sectionPages: Map<AccountCategory, SectionPosition>,
): AccountCategory | null {
  const sorted = Array.from(sectionPages.entries())
    .sort((a, b) =>
      b[1].logicalPage - a[1].logicalPage || b[1].positionY - a[1].positionY,
    );

  for (const [category, pos] of sorted) {
    if (logicalPage === pos.logicalPage) {
      if (positionY >= pos.positionY) return category;
    } else if (logicalPage > pos.logicalPage) {
      return category;
    }
  }

  return null;
}

function inferCategoryFromTable(ct: ContextTable): AccountCategory | null {
  const text = [
    ct.precedingText,
    ...ct.table.headers,
    ...ct.table.rows.slice(0, 6).flat(),
  ].join(' ');

  if (text.includes('相关还款责任信息') || text.includes('还款责任金额') ||
      text.includes('责任人类型') || text.includes('主业务借款人')) {
    return 'repayResponsibility';
  }
  if (text.includes('授信协议信息') || text.includes('授信协议标识') ||
      text.includes('授信额度用途')) {
    return 'creditAgreement';
  }
  if (text.includes('贷记卡账户') || text.includes('发卡机构') ||
      text.includes('卡机构') || text.includes('账单日')) {
    return 'creditCard';
  }
  if (text.includes('循环贷账户二')) return 'revolvingLoan2';
  if (text.includes('循环贷账户一')) return 'revolvingLoan1';
  if (text.includes('非循环贷账户')) return 'nonRevolvingLoan';
  if (text.includes('管理机构') && text.includes('账户授信额度')) return 'revolvingLoan2';
  if (text.includes('管理机构') && text.includes('借款金额')) return 'nonRevolvingLoan';

  return null;
}

/** 判断是否为新账户/新条目表格（兼容 OCR 丢字：账户→戶/户） */
const ACCOUNT_PATTERN = /[账戶户]户?\d+/;
/** 扩展模式：匹配 "账户"（无数字）或 "授信协议N" */
const ENTRY_PATTERN = /^账户$|授信协议\d+/;
const ACCOUNT_ANCHOR_RE = /[账帳帐賬]\s*[户戶]\s*([0-9０-９]+|[一二三四五六七八九十]+|[?？])?/;

/** 判断表格是否超出信贷交易明细范围（已进入查询记录或更后面的章节） */
function isBeyondBoundary(ct: ContextTable, boundaryLp: number, boundaryY: number): boolean {
  if (ct.logicalPage > boundaryLp) return true;
  if (ct.logicalPage === boundaryLp && ct.positionY >= boundaryY) return true;
  return false;
}

/** 判断表格是否在信贷交易明细范围之前（尚未进入 creditDetail） */
function isBeforeCreditDetail(
  ct: ContextTable, sectionPages: Map<AccountCategory, SectionPosition>,
): boolean {
  const first = sectionPages.get('nonRevolvingLoan');
  if (!first) return false;
  if (ct.logicalPage < first.logicalPage) return true;
  if (ct.logicalPage === first.logicalPage && ct.positionY < first.positionY) return true;
  return false;
}


/** 缓存的 DocParserResult，用于溯源时扫描 layouts */
let cachedDocResult: DocParserResult | null = null;

/** 设置缓存的 DocParserResult */
export function setCachedDocResult(doc: DocParserResult): void {
  cachedDocResult = doc;
}

/**
 * 溯源查找续表对应的源账户
 * - 续表在右栏 → 向同一物理页左栏溯源
 * - 续表在左栏 → 向上一物理页右栏溯源
 *
 * 在目标栏位的 layouts 中找 y 最大（最下方）的 "账户N" 文本
 */
function findSourceCategory(
  currentIdx: number,
  tables: ContextTable[],
  sectionPages: Map<AccountCategory, SectionPosition>,
): AccountCategory | null {
  const current = tables[currentIdx];

  if (!cachedDocResult) {
    debugLog('[findSourceCategory] cachedDocResult 未初始化');
    return null;
  }

  // 同一逻辑页内的续表，优先找表格上方最近的账户锚点。
  const samePageAnchor = findNearestAccountAnchor(current.logicalPage, current.positionY);
  if (samePageAnchor) {
    return categorizeByPosition(current.logicalPage, samePageAnchor.y, sectionPages);
  }

  // 跨栏/跨页续表：当前逻辑页的上一页末尾衔接当前页开头。
  const previousLogicalPage = current.logicalPage - 1;
  const previousPageAnchor = previousLogicalPage >= 1
    ? findNearestAccountAnchor(previousLogicalPage)
    : null;
  if (previousPageAnchor) {
    return categorizeByPosition(previousLogicalPage, previousPageAnchor.y, sectionPages);
  }

  debugLog(
    `[findSourceCategory] 溯源失败! 续表 #${currentIdx} page=${current.pageNum} lp=${current.logicalPage} ` +
    `未在同逻辑页上方或上一逻辑页找到"账户N"文本`
  );
  return null;
}

function findNearestAccountAnchor(
  logicalPage: number,
  beforeY?: number,
): { y: number; text: string } | null {
  if (!cachedDocResult) return null;
  let bestMatch: { y: number; text: string } | null = null;

  for (const page of cachedDocResult.pages) {
    for (const layout of page.layouts) {
      const text = layout.text?.trim() ?? '';
      if (!ACCOUNT_PATTERN.test(text) && !ENTRY_PATTERN.test(text)) continue;
      if (getLayoutLogicalPage(page, layout) !== logicalPage) continue;
      const y = layout.position[1];
      if (beforeY !== undefined && y >= beforeY) continue;

      if (!bestMatch || y > bestMatch.y) {
        bestMatch = { y, text };
      }
    }
  }

  return bestMatch;
}

function createEmptyAccountSegmentMap(): AccountSegmentMap {
  return {
    nonRevolvingLoan: [],
    revolvingLoan1: [],
    revolvingLoan2: [],
    creditCard: [],
    repayResponsibility: [],
    creditAgreement: [],
  };
}

function createEmptyAccountTableGroups(): Record<AccountCategory, ContextTable[]> {
  return {
    nonRevolvingLoan: [],
    revolvingLoan1: [],
    revolvingLoan2: [],
    creditCard: [],
    repayResponsibility: [],
    creditAgreement: [],
  };
}

export function flattenAccountSegments(
  segments: AccountSegmentMap,
): Record<AccountCategory, ContextTable[]> {
  const groups = createEmptyAccountTableGroups();
  for (const category of Object.keys(segments) as AccountCategory[]) {
    groups[category] = segments[category].flatMap((segment) => segment.tables);
  }
  return groups;
}

export function isAccountSummaryTable(ct: ContextTable): boolean {
  const text = [
    ct.precedingText,
    ...ct.table.headers,
    ...ct.table.rows.slice(0, 4).flat(),
  ].join('').replace(/\s+/g, '');
  return text.includes('余额') &&
    (text.includes('信息汇总') || (text.includes('管理机构数') && text.includes('账户数')));
}

export function groupAccountSegments(tables: ContextTable[]): AccountSegmentMap {
  const segments = createEmptyAccountSegmentMap();
  if (tables.length === 0) return segments;

  const sectionPages = getSectionPageMap();
  const queryRecordSection = getLevel1Map().get('queryRecord');
  const boundaryLp = queryRecordSection?.logicalPageStart ?? Infinity;
  const boundaryY = queryRecordSection?.positionY ?? 0;

  if (!cachedDocResult) {
    return groupSegmentsFromTablesOnly(tables, sectionPages, boundaryLp, boundaryY);
  }

  const events = buildReadingEvents(tables);
  let currentCategory: AccountCategory | null = null;
  let currentSegment: AccountSegment | null = null;
  let pendingAccountLabel: string | null = null;
  let segmentIndex = 0;

  const startSegment = (
    category: AccountCategory,
    table: ContextTable,
    accountLabel: string | null,
    source: AccountSegment['source'],
  ): AccountSegment => {
    const segment: AccountSegment = {
      category,
      accountLabel: accountLabel || `implicit-${category}-${segmentIndex + 1}`,
      tables: [],
      logicalPage: table.logicalPage,
      positionY: table.positionY,
      positionX: table.positionX,
      index: segmentIndex++,
      source,
    };
    segments[category].push(segment);
    return segment;
  };

  for (const event of events) {
    if (event.kind === 'stop') {
      currentCategory = null;
      currentSegment = null;
      pendingAccountLabel = null;
      continue;
    }

    if (event.kind === 'category') {
      currentCategory = event.category ?? null;
      currentSegment = null;
      pendingAccountLabel = null;
      continue;
    }

    if (event.kind === 'account') {
      pendingAccountLabel = event.accountLabel ?? '账户';
      currentSegment = null;
      continue;
    }

    if (event.kind !== 'table' || !event.table) continue;
    const table = event.table;
    if (isAccountSummaryTable(table)) continue;
    if (isBeforeCreditDetail(table, sectionPages)) continue;
    if (isBeyondBoundary(table, boundaryLp, boundaryY)) continue;

    const tableAnchor = detectAccountAnchor(table.precedingText);
    const inferredCategory = inferCategoryFromTable(table);
    const category = chooseEventCategory(currentCategory, inferredCategory, table, sectionPages);
    if (!category) continue;

    const startsNewPrimaryTable = currentSegment &&
      currentSegment.category === category &&
      !tableAnchor &&
      hasPrimaryAccountTable(table, category) &&
      currentSegment.tables.length > 0 &&
      !isSameVisualRowContinuation(currentSegment, table);

    if (tableAnchor) {
      const repeatsCurrentAccount = Boolean(currentSegment &&
        currentSegment.category === category &&
        sameEntryLabel(currentSegment.accountLabel, tableAnchor));
      if (
        repeatsCurrentAccount &&
        currentSegment &&
        shouldRepeatedAnchorStartNewSegment(currentSegment, table, category)
      ) {
        pendingAccountLabel = tableAnchor;
        currentSegment = null;
      } else if (!repeatsCurrentAccount) {
        pendingAccountLabel = tableAnchor;
        currentSegment = null;
      }
    }

    if (!currentSegment || currentSegment.category !== category) {
      currentSegment = startSegment(
        category,
        table,
        pendingAccountLabel,
        pendingAccountLabel ? 'anchor' : 'inferred',
      );
    }

    if (startsNewPrimaryTable) {
      currentSegment = startSegment(category, table, null, 'inferred');
    }

    currentSegment.tables.push(table);
    if (pendingAccountLabel) pendingAccountLabel = null;
  }

  return segments;
}

function chooseEventCategory(
  currentCategory: AccountCategory | null,
  inferredCategory: AccountCategory | null,
  table: ContextTable,
  sectionPages: Map<AccountCategory, SectionPosition>,
): AccountCategory | null {
  const positionedCategory = categorizeByPosition(table.logicalPage, table.positionY, sectionPages);

  if (
    inferredCategory &&
    inferredCategory !== currentCategory &&
    hasExplicitCategoryEvidence(table, inferredCategory)
  ) {
    return inferredCategory;
  }

  if (
    inferredCategory &&
    inferredCategory !== currentCategory &&
    hasDistinctCategoryEvidence(inferredCategory) &&
    hasPrimaryAccountTable(table, inferredCategory)
  ) {
    return inferredCategory;
  }

  if (positionedCategory) return positionedCategory;

  return currentCategory ??
    inferredCategory;
}

function hasExplicitCategoryEvidence(table: ContextTable, category: AccountCategory): boolean {
  const text = normalizeAccountEvidence([
    table.precedingText,
    ...table.table.headers,
    ...table.table.rows.slice(0, 2).flat(),
  ].join(' '));
  return getCategoryLabels(category).some((label) => text.includes(label));
}

function getCategoryLabels(category: AccountCategory): string[] {
  switch (category) {
    case 'nonRevolvingLoan':
      return ['非循环贷账户'];
    case 'revolvingLoan1':
      return ['循环贷账户一'];
    case 'revolvingLoan2':
      return ['循环贷账户二'];
    case 'creditCard':
      return ['贷记卡账户'];
    case 'repayResponsibility':
      return ['相关还款责任信息'];
    case 'creditAgreement':
      return ['授信协议信息'];
    default:
      return [];
  }
}

function hasDistinctCategoryEvidence(category: AccountCategory): boolean {
  return category !== 'nonRevolvingLoan' && category !== 'revolvingLoan1';
}

function hasPrimaryAccountTable(table: ContextTable, category: AccountCategory): boolean {
  const text = normalizeAccountEvidence([
    ...table.table.headers,
    ...table.table.rows.slice(0, 2).flat(),
  ].join(' '));

  if (category === 'nonRevolvingLoan' || category === 'revolvingLoan1') {
    return hasManagerLabel(text) && (text.includes('借款金额') || text.includes('款金额'));
  }
  if (category === 'revolvingLoan2') {
    return hasManagerLabel(text) && hasCreditLimitLabel(text);
  }
  if (category === 'creditCard') {
    return hasCardIssuerLabel(text) && hasCreditLimitLabel(text);
  }
  if (category === 'repayResponsibility') {
    return text.includes('还款责任') || text.includes('责任人类型');
  }
  if (category === 'creditAgreement') {
    return text.includes('授信协议') || text.includes('授信额度用途');
  }
  return false;
}

function normalizeAccountEvidence(value: string): string {
  return value
    .replace(/\s+/g, '')
    .replace(/[■□�]/g, '')
    .replace(/管利/g, '管理')
    .replace(/管机/g, '管理机')
    .replace(/僧款/g, '借款');
}

function hasManagerLabel(text: string): boolean {
  return text.includes('管理机构') ||
    (text.includes('管') && text.includes('机构'));
}

function hasCardIssuerLabel(text: string): boolean {
  return text.includes('发卡机构') ||
    text.includes('卡机构') ||
    (text.includes('卡') && text.includes('机构'));
}

function hasCreditLimitLabel(text: string): boolean {
  return text.includes('授信额度') ||
    text.includes('投信额度') ||
    text.includes('受信额度') ||
    text.includes('授销额度') ||
    (text.includes('账户') && text.includes('额度'));
}

function groupSegmentsFromTablesOnly(
  tables: ContextTable[],
  sectionPages: Map<AccountCategory, SectionPosition>,
  boundaryLp: number,
  boundaryY: number,
): AccountSegmentMap {
  const segments = createEmptyAccountSegmentMap();
  let currentSegment: AccountSegment | null = null;
  let segmentIndex = 0;

  for (const table of tables) {
    if (isAccountSummaryTable(table)) continue;
    if (isBeforeCreditDetail(table, sectionPages)) continue;
    if (isBeyondBoundary(table, boundaryLp, boundaryY)) continue;

    const inferredCategory = inferCategoryFromTable(table);
    const category = chooseEventCategory(null, inferredCategory, table, sectionPages);
    if (!category) continue;

    const tableAnchor = detectAccountAnchor(table.precedingText);
    const startsNewPrimaryTable = currentSegment &&
      currentSegment.category === category &&
      !tableAnchor &&
      hasPrimaryAccountTable(table, category) &&
      currentSegment.tables.length > 0 &&
      !isSameVisualRowContinuation(currentSegment, table);

    const repeatsCurrentAccount = tableAnchor &&
      currentSegment &&
      currentSegment.category === category &&
      sameEntryLabel(currentSegment.accountLabel, tableAnchor);
    const repeatedAnchorStartsNewSegment = Boolean(
      repeatsCurrentAccount &&
      currentSegment &&
      shouldRepeatedAnchorStartNewSegment(currentSegment, table, category),
    );

    if (
      (tableAnchor && (!repeatsCurrentAccount || repeatedAnchorStartsNewSegment)) ||
      startsNewPrimaryTable ||
      !currentSegment ||
      currentSegment.category !== category
    ) {
      currentSegment = {
        category,
        accountLabel: tableAnchor || `implicit-${category}-${segmentIndex + 1}`,
        tables: [],
        logicalPage: table.logicalPage,
        positionY: table.positionY,
        positionX: table.positionX,
        index: segmentIndex++,
        source: tableAnchor ? 'anchor' : 'inferred',
      };
      segments[category].push(currentSegment);
    }

    currentSegment.tables.push(table);
  }

  return segments;
}

function isSameVisualRowContinuation(
  currentSegment: AccountSegment,
  table: ContextTable,
): boolean {
  const previous = currentSegment.tables[currentSegment.tables.length - 1];
  if (!previous) return false;
  return previous.logicalPage === table.logicalPage &&
    Math.abs(previous.positionY - table.positionY) <= 24 &&
    table.positionX > previous.positionX;
}

function sameEntryLabel(a: string, b: string): boolean {
  return normalizeEntryLabel(a) === normalizeEntryLabel(b);
}

function normalizeEntryLabel(value: string): string {
  return value
    .replace(/\s+/g, '')
    .replace(/[帳帐賬]/g, '账')
    .replace(/戶/g, '户')
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

interface AccountIdentityEvidence {
  org: string;
  accountId: string;
  openDate: string;
  creditAmount: number;
}

function shouldRepeatedAnchorStartNewSegment(
  currentSegment: AccountSegment,
  table: ContextTable,
  category: AccountCategory,
): boolean {
  if (!isCreditAccountDetailCategory(category)) return false;
  if (!hasPrimaryAccountTable(table, category)) return false;

  const previousPrimary = [...currentSegment.tables]
    .reverse()
    .find((item) => hasPrimaryAccountTable(item, category));
  if (!previousPrimary) return false;

  const previous = extractAccountIdentityEvidence(previousPrimary, category);
  const next = extractAccountIdentityEvidence(table, category);
  return hasConflictingAccountIdentity(previous, next);
}

function isCreditAccountDetailCategory(category: AccountCategory): boolean {
  return category === 'nonRevolvingLoan' ||
    category === 'revolvingLoan1' ||
    category === 'revolvingLoan2' ||
    category === 'creditCard';
}

function extractAccountIdentityEvidence(
  table: ContextTable,
  category: AccountCategory,
): AccountIdentityEvidence {
  const amountLabels = category === 'nonRevolvingLoan' || category === 'revolvingLoan1'
    ? ['借款金额', '僧款金额', '款金额']
    : ['账户授信额度', '授信额度'];
  const orgLabels = category === 'creditCard'
    ? ['发卡机构', '卡机构']
    : ['管理机构', '管机构'];

  return {
    org: findEvidenceValue(table, orgLabels),
    accountId: findEvidenceValue(table, ['账户标识', '账户状识', '账户标只', '账户R']),
    openDate: findEvidenceDate(findEvidenceValue(table, ['开立日期', '日期开立'])),
    creditAmount: parseEvidenceAmount(findEvidenceValue(table, amountLabels)),
  };
}

function hasConflictingAccountIdentity(
  previous: AccountIdentityEvidence,
  next: AccountIdentityEvidence,
): boolean {
  if (isMeaningfulAccountId(previous.accountId) && isMeaningfulAccountId(next.accountId)) {
    return normalizeIdentityText(previous.accountId) !== normalizeIdentityText(next.accountId);
  }

  if (isMeaningfulOrg(previous.org) && isMeaningfulOrg(next.org) && isDifferentOrg(previous.org, next.org)) {
    return true;
  }

  if (
    previous.creditAmount > 0 &&
    next.creditAmount > 0 &&
    previous.creditAmount !== next.creditAmount &&
    previous.openDate &&
    next.openDate &&
    previous.openDate !== next.openDate
  ) {
    return true;
  }

  return false;
}

function findEvidenceValue(table: ContextTable, labels: string[]): string {
  const rows = [table.table.headers, ...table.table.rows];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] ?? [];
    const valueRow = rows[rowIndex + 1] ?? [];
    for (let colIndex = 0; colIndex < row.length; colIndex++) {
      if (!labels.some((label) => matchesEvidenceLabel(row[colIndex] ?? '', label))) continue;
      const candidates = [
        valueRow[colIndex],
        valueRow[colIndex + 1],
        row[colIndex + 1],
        row[colIndex + 2],
      ];
      for (const candidate of candidates) {
        const value = normalizeEvidenceValue(candidate ?? '');
        if (value && !labels.some((label) => matchesEvidenceLabel(value, label))) return value;
      }
    }
  }
  return '';
}

function matchesEvidenceLabel(raw: string, label: string): boolean {
  const value = normalizeEvidenceLabel(raw);
  const target = normalizeEvidenceLabel(label);
  if (!value || !target) return false;
  if (value.includes(target) || target.includes(value)) return true;
  if (target === '管理机构') return value.includes('管') && value.includes('机构');
  if (target === '发卡机构') return value.includes('卡机构');
  if (target === '账户标识') return value.includes('账户') && /标|状|识|R/i.test(value);
  if (target === '开立日期') return value.includes('开立') && value.includes('日期');
  if (target === '借款金额') return value.includes('款') && value.includes('金额');
  if (target === '账户授信额度') return value.includes('授信') && value.includes('额度');
  return false;
}

function normalizeEvidenceLabel(value: string): string {
  return value
    .replace(/\s+/g, '')
    .replace(/[■□�]/g, '')
    .replace(/管利/g, '管理')
    .replace(/管机/g, '管理机')
    .replace(/僧款/g, '借款')
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');
}

function normalizeEvidenceValue(value: string): string {
  return value
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .trim();
}

function parseEvidenceAmount(value: string): number {
  const match = value.replace(/[￥¥元,\s]/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return 0;
  const normalized = match[0].replace(/\.(\d{3})(?!\d)/g, '$1');
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : 0;
}

function findEvidenceDate(value: string): string {
  const match = value.match(/\d{4}[.\-/年]\d{1,2}[.\-/月]\d{1,2}日?/);
  return match?.[0].replace(/年|月/g, '.').replace(/日/g, '') ?? '';
}

function isMeaningfulAccountId(value: string): boolean {
  return normalizeIdentityText(value).length >= 8;
}

function isMeaningfulOrg(value: string): boolean {
  const normalized = normalizeIdentityText(value);
  if (normalized.length < 4) return false;
  if (/^(?:有限|有限公司|股份|股份有限公司|公司|银行|机构)$/.test(normalized)) return false;
  return /银行|公司|租赁|金融|贷款|担保|信托|信用社|合作社/.test(value);
}

function isDifferentOrg(a: string, b: string): boolean {
  const left = stripCommonOrgSuffix(normalizeIdentityText(a));
  const right = stripCommonOrgSuffix(normalizeIdentityText(b));
  if (!left || !right) return false;
  if (left === right) return false;
  if ((left.includes(right) || right.includes(left)) && Math.min(left.length, right.length) >= 3) return false;
  return identitySimilarity(left, right) < 0.58;
}

function normalizeIdentityText(value: string): string {
  return normalizeEvidenceValue(value)
    .replace(/\s+/g, '')
    .replace(/[■□�]/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '')
    .toLowerCase();
}

function stripCommonOrgSuffix(value: string): string {
  return value
    .replace(/股份有限公司|有限责任公司|有限公司|股份公司/g, '')
    .replace(/银行|消费金融|小额贷款|融资租赁|融资担保/g, '');
}

function identitySimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const lcs = longestCommonSubsequenceLength(a, b);
  return lcs / Math.max(a.length, b.length);
}

function longestCommonSubsequenceLength(a: string, b: string): number {
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

/**
 * 将 creditAccount 桶中的表格按逻辑页码范围精确分组
 *
 * 策略：
 * 1. 使用从 DocParserResult layouts 中预先扫描的章节页码映射
 * 2. 判断表格是新账户还是续表（通过 precedingText 是否匹配"账户N"）
 * 3. 续表向前溯源，继承源表格的分类
 */
export function groupAccountTables(
  tables: ContextTable[],
): Record<AccountCategory, ContextTable[]> {
  const groups: Record<AccountCategory, ContextTable[]> = createEmptyAccountTableGroups();

  if (tables.length === 0) return groups;

  const sectionPages = getSectionPageMap();

  // 计算信贷交易明细的边界：queryRecord 起始位置之后的表格不属于账户
  const queryRecordSection = getLevel1Map().get('queryRecord');
  const boundaryLp = queryRecordSection?.logicalPageStart ?? Infinity;
  const boundaryY = queryRecordSection?.positionY ?? 0;
  const assignedTables = groupTablesByReadingStream(tables, groups);

  // 第一遍：为所有新条目表格分配分类
  const categoryMap = new Map<number, AccountCategory>();
  for (let idx = 0; idx < tables.length; idx++) {
    const ct = tables[idx];
    if (assignedTables.has(ct)) continue;
    // 跳过不在信贷交易明细范围内的表格（上界 + 下界）
    if (isBeforeCreditDetail(ct, sectionPages)) continue;
    if (isBeyondBoundary(ct, boundaryLp, boundaryY)) continue;
    // 匹配 "账户N" 或 "账户"（无数字）或 "授信协议N"
    if (ACCOUNT_PATTERN.test(ct.precedingText) || ENTRY_PATTERN.test(ct.precedingText)) {
      const category = categorizeByPosition(ct.logicalPage, ct.positionY, sectionPages) ??
        inferCategoryFromTable(ct);
      if (category) {
        categoryMap.set(idx, category);
      }
    }
  }

  // 第二遍：为续表溯源分配分类
  let newAccountCount = 0;
  let lastCategory: AccountCategory | null = null;
  for (let idx = 0; idx < tables.length; idx++) {
    const ct = tables[idx];
    if (assignedTables.has(ct)) continue;
    // 跳过不在信贷交易明细范围内的表格（上界 + 下界）
    if (isBeforeCreditDetail(ct, sectionPages)) continue;
    if (isBeyondBoundary(ct, boundaryLp, boundaryY)) continue;
    // 判断是否为新条目：匹配 "账户N" 或 "账户"（无数字）或 "授信协议N"
    const isNewEntry = ACCOUNT_PATTERN.test(ct.precedingText) || ENTRY_PATTERN.test(ct.precedingText);

    let category: AccountCategory | null = null;

    if (isNewEntry) {
      category = categoryMap.get(idx) ?? inferCategoryFromTable(ct);
      newAccountCount++;
    } else {
      category = findSourceCategory(idx, tables, sectionPages);
      // 溯源失败时：先尝试用自身位置推断分类，再回退到前一张表
      if (!category) {
        category = categorizeByPosition(ct.logicalPage, ct.positionY, sectionPages);
      }
      if (!category) {
        category = inferCategoryFromTable(ct);
      }
      if (!category && lastCategory) {
        category = lastCategory;
      }
    }

    if (category) {
      groups[category].push(ct);
      lastCategory = category;
    }
  }

  return groups;
}

function groupTablesByReadingStream(
  tables: ContextTable[],
  groups: Record<AccountCategory, ContextTable[]>,
): Set<ContextTable> {
  const assigned = new Set<ContextTable>();
  if (!cachedDocResult) return assigned;

  const events = buildReadingEvents(tables);
  let currentCategory: AccountCategory | null = null;
  let currentAccount: string | null = null;

  for (const event of events) {
    if (event.kind === 'stop') {
      currentCategory = null;
      currentAccount = null;
      continue;
    }

    if (event.kind === 'category') {
      currentCategory = event.category ?? null;
      currentAccount = null;
      continue;
    }

    if (event.kind === 'account') {
      currentAccount = event.accountLabel ?? '账户';
      continue;
    }

    if (event.kind !== 'table' || !event.table) continue;
    const table = event.table;

    const category = currentCategory ?? inferCategoryFromTable(table);
    if (!category) continue;

    groups[category].push(table);
    assigned.add(table);

    // 没有识别到账户锚点时，内容证据仍可承接到当前大类；
    // 一旦后续出现无表头续表，currentCategory 会继续负责归属。
    if (!currentAccount && (ACCOUNT_PATTERN.test(table.precedingText) || ENTRY_PATTERN.test(table.precedingText))) {
      currentAccount = table.precedingText;
    }
  }

  return assigned;
}

function buildReadingEvents(tables: ContextTable[]): ReadingEvent[] {
  const events: ReadingEvent[] = [];
  let sourceIndex = 0;

  for (const page of cachedDocResult?.pages ?? []) {
    for (const layout of page.layouts) {
      if (layout.type === 'table') continue;
      const text = layout.text?.trim() ?? '';
      if (!text) continue;

      const logicalPage = getLayoutLogicalPage(page, layout);
      const base = {
        logicalPage,
        positionY: layout.position[1],
        positionX: layout.position[0],
        sourceIndex: sourceIndex++,
      };

      const category = detectAccountCategoryTitle(text);
      if (category) {
        events.push({ ...base, kind: 'category', category });
        continue;
      }

      if (detectStopTitle(text)) {
        events.push({ ...base, kind: 'stop' });
        continue;
      }

      const accountLabel = detectAccountAnchor(text);
      if (accountLabel) {
        events.push({ ...base, kind: 'account', accountLabel });
      }
    }
  }

  for (const table of tables) {
    events.push({
      kind: 'table',
      logicalPage: table.logicalPage,
      positionY: table.positionY,
      positionX: table.positionX,
      sourceIndex: sourceIndex++,
      table,
    });
  }

  return events.sort(compareReadingEvents);
}

function compareReadingEvents(a: ReadingEvent, b: ReadingEvent): number {
  return a.logicalPage - b.logicalPage ||
    a.positionY - b.positionY ||
    a.positionX - b.positionX ||
    eventRank(a.kind) - eventRank(b.kind) ||
    a.sourceIndex - b.sourceIndex;
}

function eventRank(kind: ReadingEvent['kind']): number {
  if (kind === 'category') return 0;
  if (kind === 'stop') return 0;
  if (kind === 'account') return 1;
  return 2;
}

function detectAccountCategoryTitle(text: string): AccountCategory | null {
  const normalized = text.replace(/\s+/g, '');
  if (/[（(]一[）)]?非循环贷账户/.test(normalized) || normalized === '非循环贷账户') {
    return 'nonRevolvingLoan';
  }
  if (/[（(]二[）)]?循环贷账户一/.test(normalized) || normalized === '循环贷账户一') {
    return 'revolvingLoan1';
  }
  if (/[（(]三[）)]?循环贷账户二/.test(normalized) || normalized === '循环贷账户二') {
    return 'revolvingLoan2';
  }
  if (/[（(]四[）)]?贷记卡账户/.test(normalized) || normalized === '贷记卡账户') {
    return 'creditCard';
  }
  if (/[（(]五[）)]?相关还款责任信息/.test(normalized) || normalized === '相关还款责任信息') {
    return 'repayResponsibility';
  }
  if (/[（(]六[）)]?授信协议信息/.test(normalized) || normalized === '授信协议信息') {
    return 'creditAgreement';
  }
  return null;
}

function detectStopTitle(text: string): boolean {
  const normalized = text.replace(/\s+/g, '');
  return /^四查询记录/.test(normalized) ||
    normalized === '查询记录' ||
    normalized === '报告说明' ||
    normalized === '编制说明';
}

function detectAccountAnchor(text: string): string | null {
  const normalized = text.replace(/\s+/g, '');
  if (/账户状态|账户标识|账户授信额度|账户币种|账户关闭|账户数|账户信息汇总/.test(normalized)) {
    return null;
  }
  if (/非循环贷账户|循环贷账户|贷记卡账户|准贷记卡账户/.test(normalized)) {
    return null;
  }
  const match = normalized.match(ACCOUNT_ANCHOR_RE);
  return match?.[0] ?? null;
}
