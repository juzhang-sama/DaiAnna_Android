/**
 * 章节定位器 — 从 DocParserResult 扫描一级/二级模块标题，建立逻辑页码范围映射
 *
 * 递归定位策略：
 * 1. 先定位一级模块（个人基本信息、信息概要、信贷交易信息明细等）
 * 2. 再在每个一级模块内定位二级子模块（非循环贷、循环贷一、循环贷二、贷记卡等）
 */

import type { DocParserResult } from '../../shared/doc-parser-types';
import { getLayoutLogicalPage } from './reading-order';
import { debugLog } from '../utils/debug-log';

/** 章节位置信息 */
export interface SectionLocation {
  /** 章节名称（用于调试） */
  name: string;
  /** 起始逻辑页码 */
  logicalPageStart: number;
  /** 结束逻辑页码（下一个同级章节的起始页 - 1，最后一个章节为 Infinity） */
  logicalPageEnd: number;
  /** 章节标题的 y 坐标（用于同页内排序） */
  positionY: number;
}

/** 一级模块类型 */
export type Level1Section =
  | 'personalInfo'    // 一 个人基本信息
  | 'infoSummary'     // 二 信息概要
  | 'creditDetail'    // 三 信贷交易信息明细
  | 'queryRecord'     // 四 查询记录
  | 'selfQueryDetail' // 本人查询记录明细
  | 'reportNote'      // 报告说明
  | 'editNote';       // 编制说明

/** 二级模块类型（信贷交易信息明细下） */
export type Level2CreditSection =
  | 'nonRevolvingLoan'    // (一) 非循环贷账户
  | 'revolvingLoan1'      // (二) 循环贷账户一
  | 'revolvingLoan2'      // (三) 循环贷账户二
  | 'creditCard'          // (四) 贷记卡账户
  | 'repayResponsibility' // (五) 相关还款责任信息
  | 'creditAgreement';    // (六) 授信协议信息

/** 一级模块关键词 — 严格匹配，避免误匹配二级标题 */
const LEVEL1_KEYWORDS: Array<{ pattern: RegExp; type: Level1Section }> = [
  // "一个人基本信息" 或 "一 个人基本信息"（OCR可能漏空格）
  { pattern: /^一\s*个人基本信息/, type: 'personalInfo' },
  // "二 信息概要" — 不能匹配 "信贷交易授信及负债信息概要"
  { pattern: /^二\s*信息概要/, type: 'infoSummary' },
  // "三 信贷交易信息明细"
  { pattern: /^三\s*信贷交易信息明细/, type: 'creditDetail' },
  // "四 查询记录" — 不能匹配 "(三)查询记录概要"
  { pattern: /^四\s*查询记录/, type: 'queryRecord' },
  // "本人查询记录明细"
  { pattern: /^本人查询记录明细/, type: 'selfQueryDetail' },
  // 报告说明、编制说明
  { pattern: /^报告说明/, type: 'reportNote' },
  { pattern: /^编制说明/, type: 'editNote' },
];

/** 二级模块关键词（信贷交易信息明细下） */
const LEVEL2_CREDIT_KEYWORDS: Array<{ pattern: RegExp; type: Level2CreditSection }> = [
  { pattern: /[（(]一[）)]\s*非循环贷账户|非循环贷账户/, type: 'nonRevolvingLoan' },
  { pattern: /[（(]二[）)]\s*循环贷账户一|循环贷账户一/, type: 'revolvingLoan1' },
  { pattern: /[（(]三[）)]\s*循环贷账户二|循环贷账户二/, type: 'revolvingLoan2' },
  { pattern: /[（(]四[）)]\s*贷记卡账户|贷记卡账户/, type: 'creditCard' },
  { pattern: /[（(]五[）)]\s*相关还款责任信息|相关还款责任信息/, type: 'repayResponsibility' },
  { pattern: /[（(]六[）)]\s*授信协议信息|授信协议信息/, type: 'creditAgreement' },
];

/** 一级模块的固定顺序（征信报告结构） */
const L1_SECTION_ORDER: Level1Section[] = [
  'personalInfo', 'infoSummary', 'creditDetail',
  'queryRecord', 'selfQueryDetail', 'reportNote', 'editNote',
];

/** 扫描结果缓存 */
let cachedLevel1Map: Map<Level1Section, SectionLocation> | null = null;
let cachedLevel2CreditMap: Map<Level2CreditSection, SectionLocation> | null = null;

/**
 * 从 DocParserResult 扫描一级模块标题，建立逻辑页码范围映射
 */
export function scanLevel1Sections(doc: DocParserResult): Map<Level1Section, SectionLocation> {
  const found: Array<{ type: Level1Section; name: string; lp: number; y: number }> = [];

  for (const page of doc.pages) {
    for (const layout of page.layouts) {
      if (layout.type === 'table') continue;
      const text = layout.text?.trim() ?? '';
      if (!text) continue;

      for (const { pattern, type } of LEVEL1_KEYWORDS) {
        if (pattern.test(text)) {
          const lp = getLayoutLogicalPage(page, layout);
          upsertEarliestSection(found, { type, name: text.slice(0, 20), lp, y: layout.position[1] });
          break;
        }
      }
    }
  }

  // 按征信报告固定结构排序（不依赖逻辑页码顺序）
  found.sort((a, b) => {
    const ia = L1_SECTION_ORDER.indexOf(a.type);
    const ib = L1_SECTION_ORDER.indexOf(b.type);
    if (ia !== ib) return ia - ib;
    return a.lp - b.lp || a.y - b.y;
  });

  // 备选方案：如果没找到 queryRecord，用 selfQueryDetail 位置反推
  const hasQueryRecord = found.some((f) => f.type === 'queryRecord');
  const selfQueryDetail = found.find((f) => f.type === 'selfQueryDetail');
  if (!hasQueryRecord && selfQueryDetail) {
    // queryRecord 应该在 selfQueryDetail 前2页左右（根据征信报告结构）
    const inferredLp = Math.max(selfQueryDetail.lp - 2, 1);
    found.push({ type: 'queryRecord', name: '四 查询记录(推断)', lp: inferredLp, y: 0 });
    // 重新排序
    found.sort((a, b) => a.lp - b.lp || a.y - b.y);
    debugLog(`[scanLevel1Sections] queryRecord 未找到，根据 selfQueryDetail@lp${selfQueryDetail.lp} 推断为 lp${inferredLp}`);
  }

  // 构建映射，计算每个章节的结束页码
  const map = new Map<Level1Section, SectionLocation>();
  for (let i = 0; i < found.length; i++) {
    const curr = found[i];
    const next = found[i + 1];
    map.set(curr.type, {
      name: curr.name,
      logicalPageStart: curr.lp,
      logicalPageEnd: next ? next.lp - 1 : Infinity,
      positionY: curr.y,
    });
  }

  debugLog('[scanLevel1Sections] found:', found.map((f) => `${f.type}@lp${f.lp}`).join(', '));
  cachedLevel1Map = map;
  return map;
}

/**
 * 从 DocParserResult 扫描二级模块标题（信贷交易信息明细下）
 */
export function scanLevel2CreditSections(doc: DocParserResult): Map<Level2CreditSection, SectionLocation> {
  const found: Array<{ type: Level2CreditSection; name: string; lp: number; y: number }> = [];

  for (const page of doc.pages) {
    for (const layout of page.layouts) {
      if (layout.type === 'table') continue;
      const text = layout.text?.trim() ?? '';
      if (!text) continue;

      for (const { pattern, type } of LEVEL2_CREDIT_KEYWORDS) {
        if (pattern.test(text)) {
          const lp = getLayoutLogicalPage(page, layout);
          upsertEarliestSection(found, { type, name: text.slice(0, 20), lp, y: layout.position[1] });
          break;
        }
      }
    }
  }

  // 按逻辑页码排序
  found.sort((a, b) => a.lp - b.lp || a.y - b.y);

  // 构建映射
  const map = new Map<Level2CreditSection, SectionLocation>();
  for (let i = 0; i < found.length; i++) {
    const curr = found[i];
    const next = found[i + 1];
    map.set(curr.type, {
      name: curr.name,
      logicalPageStart: curr.lp,
      logicalPageEnd: next ? next.lp - 1 : Infinity,
      positionY: curr.y,
    });
  }

  debugLog('[scanLevel2CreditSections] found:', found.map((f) => `${f.type}@lp${f.lp}y${f.y}`).join(', '));
  cachedLevel2CreditMap = map;
  return map;
}

/** 获取缓存的一级模块映射 */
export function getLevel1Map(): Map<Level1Section, SectionLocation> {
  return cachedLevel1Map ?? new Map();
}

/** 获取缓存的二级模块映射（信贷交易信息明细下） */
export function getLevel2CreditMap(): Map<Level2CreditSection, SectionLocation> {
  return cachedLevel2CreditMap ?? new Map();
}

function upsertEarliestSection<T extends string>(
  found: Array<{ type: T; name: string; lp: number; y: number }>,
  next: { type: T; name: string; lp: number; y: number },
): void {
  const existingIndex = found.findIndex((item) => item.type === next.type);
  if (existingIndex < 0) {
    found.push(next);
    return;
  }

  const existing = found[existingIndex];
  if (next.lp < existing.lp || (next.lp === existing.lp && next.y < existing.y)) {
    found[existingIndex] = next;
  }
}
