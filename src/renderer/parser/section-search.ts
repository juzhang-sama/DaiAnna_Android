/**
 * 章节内关键词搜索 — 在已确定的模块范围内搜索关键词并提取数值
 *
 * 核心思路：
 * 1. 利用 section-locator 确定的模块范围（逻辑页码 + y坐标）
 * 2. 在范围内搜索关键词，提取匹配项及其关联数值
 * 3. 支持统计匹配数量、累加数值等操作
 */

import type { DocParserResult } from '../../shared/doc-parser-types';
import { getLevel2CreditMap, type Level2CreditSection, type SectionLocation } from './section-locator';
import { getLayoutLogicalPage } from './reading-order';
import { debugLog } from '../utils/debug-log';

const ACCOUNT_ANCHOR_RE = /[账帐帳賬]\s*[户戶]\s*([0-9０-９]+)/g;

/** 搜索结果项 */
export interface SearchHit {
  /** 匹配的文本 */
  text: string;
  /** 逻辑页码 */
  logicalPage: number;
  /** y 坐标 */
  positionY: number;
  /** x 坐标 */
  positionX: number;
  /** 物理页码 */
  pageNum: number;
}

/** 判断位置是否在章节范围内 */
function isInSection(
  lp: number,
  y: number,
  section: SectionLocation,
  nextSection?: SectionLocation,
): boolean {
  if (lp < section.logicalPageStart) {
    return false;
  }
  // 同一起始页时，y 坐标必须 >= 章节标题 y 坐标
  if (lp === section.logicalPageStart && y < section.positionY) {
    return false;
  }
  // 如果有下一个章节，需要检查是否超出范围
  if (nextSection) {
    if (lp > nextSection.logicalPageStart) {
      return false;
    }
    // 同一逻辑页时，y 坐标必须 < 下一章节标题 y 坐标
    if (lp === nextSection.logicalPageStart && y >= nextSection.positionY) {
      return false;
    }
  }
  return true;
}

/**
 * 在指定章节范围内搜索关键词
 * @param doc DocParserResult
 * @param section 章节范围
 * @param nextSection 下一个章节（用于确定上边界）
 * @param pattern 搜索模式（字符串或正则）
 * @returns 匹配结果数组
 */
export function searchInSection(
  doc: DocParserResult,
  section: SectionLocation,
  nextSection: SectionLocation | undefined,
  pattern: string | RegExp,
): SearchHit[] {
  const hits: SearchHit[] = [];
  const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;

  for (const page of doc.pages) {
    for (const layout of page.layouts) {
      const text = layout.text?.trim() ?? '';
      if (!text) continue;

      const lp = getLayoutLogicalPage(page, layout);
      const y = layout.position[1];

      if (!isInSection(lp, y, section, nextSection)) continue;

      if (regex.test(text)) {
        hits.push({
          text,
          logicalPage: lp,
          positionY: y,
          positionX: layout.position[0],
          pageNum: page.page_num,
        });
      }
    }
  }

  return hits;
}

/** 章节顺序 */
const SECTION_ORDER: Level2CreditSection[] = [
  'nonRevolvingLoan',
  'revolvingLoan1',
  'revolvingLoan2',
  'creditCard',
  'repayResponsibility',
  'creditAgreement',
];

/**
 * 统计指定二级模块内的账户数量
 * @param doc DocParserResult
 * @param sectionType 二级模块类型
 * @returns 账户数量
 */
export function countAccountsInSection(
  doc: DocParserResult,
  sectionType: Level2CreditSection,
): number {
  const sectionMap = getLevel2CreditMap();
  const section = sectionMap.get(sectionType);
  if (!section) {
    debugLog(`[countAccountsInSection] section ${sectionType} not found`);
    return 0;
  }

  // 找到下一个章节作为上边界
  const currentIndex = SECTION_ORDER.indexOf(sectionType);
  const nextSectionType = SECTION_ORDER[currentIndex + 1];
  const nextSection = nextSectionType ? sectionMap.get(nextSectionType) : undefined;

  const uniqueAccounts = new Set<string>();

  for (const page of doc.pages) {
    for (const layout of page.layouts) {
      const text = layout.text?.trim() ?? '';
      if (!text) continue;

      const lp = getLayoutLogicalPage(page, layout);
      const y = layout.position[1];
      if (!isInSection(lp, y, section, nextSection)) continue;

      for (const accountNo of extractAccountAnchorNumbers(text)) {
        uniqueAccounts.add(accountNo);
      }
    }
  }

  debugLog(`[countAccountsInSection] ${sectionType}: found ${uniqueAccounts.size} accounts`,
    Array.from(uniqueAccounts).join(', '));

  return uniqueAccounts.size;
}

function extractAccountAnchorNumbers(text: string): string[] {
  const normalized = normalizeDigits(text);
  const result: string[] = [];
  ACCOUNT_ANCHOR_RE.lastIndex = 0;

  for (const match of normalized.matchAll(ACCOUNT_ANCHOR_RE)) {
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > 0) {
      result.push(String(n));
    }
  }

  return result;
}

function normalizeDigits(text: string): string {
  return text.replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

/**
 * 统计所有二级模块的账户数量
 */
export function countAllSectionAccounts(doc: DocParserResult): Record<Level2CreditSection, number> {
  const sections: Level2CreditSection[] = [
    'nonRevolvingLoan',
    'revolvingLoan1', 
    'revolvingLoan2',
    'creditCard',
    'repayResponsibility',
    'creditAgreement',
  ];

  const result = {} as Record<Level2CreditSection, number>;
  for (const s of sections) {
    result[s] = countAccountsInSection(doc, s);
  }

  debugLog('[countAllSectionAccounts] result:', result);
  return result;
}
