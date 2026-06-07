import type {
  DocLayout,
  DocPage,
  DocParserResult,
  DocTable,
} from '../../shared/doc-parser-types';
import { FINANCIAL_INSTITUTIONS } from '../data/financial-institutions';

const KNOWN_INSTITUTION_ALIASES = Array.from(
  new Set(FINANCIAL_INSTITUTIONS.flatMap((item) => [item.name, ...(item.aliases ?? [])])),
)
  .filter((alias) => alias.trim().length >= 3)
  .sort((a, b) => b.length - a.length);

const MIN_REPLACE_SCORE = 18;
const MIN_APPEND_SCORE = 28;
const REPLACE_SCORE_MARGIN = 4;

interface ScoredTable {
  layout: DocLayout;
  table: DocTable;
  score: number;
}

export function fuseDocParserCandidateTables(
  selected: DocParserResult,
  candidates: DocParserResult[],
): DocParserResult {
  if (candidates.length <= 1) return selected;

  const result = cloneDocParserResult(selected);
  const knownSignatures = new Set<string>();
  for (const page of result.pages) {
    for (const table of page.tables) knownSignatures.add(tableSignature(table.markdown));
  }

  for (const candidate of candidates) {
    if (candidate === selected) continue;
    candidate.pages.forEach((candidatePage, pageIndex) => {
      const targetPage = result.pages[pageIndex];
      if (!targetPage) return;

      for (const scored of collectScoredCreditTables(candidatePage)) {
        const overlapping = findOverlappingTable(targetPage, scored.layout.position);
        if (overlapping) {
          if (
            scored.score >= MIN_REPLACE_SCORE &&
            scored.score >= overlapping.score + REPLACE_SCORE_MARGIN
          ) {
            replaceTable(targetPage, overlapping.layoutIndex, overlapping.tableIndex, scored);
            knownSignatures.add(tableSignature(scored.table.markdown));
          }
          continue;
        }

        const signature = tableSignature(scored.table.markdown);
        if (scored.score < MIN_APPEND_SCORE || knownSignatures.has(signature)) continue;
        appendTable(targetPage, scored);
        knownSignatures.add(signature);
      }
    });
  }

  return result;
}

function collectScoredCreditTables(page: DocPage): ScoredTable[] {
  const tables: ScoredTable[] = [];
  for (const layout of page.layouts) {
    if (layout.type !== 'table') continue;
    const table = page.tables.find((item) => item.layout_id === layout.layout_id);
    if (!table?.markdown?.trim()) continue;
    const score = scoreCreditTable(table.markdown, layout.text);
    if (score >= MIN_REPLACE_SCORE) tables.push({ layout, table, score });
  }
  return tables;
}

function replaceTable(
  page: DocPage,
  layoutIndex: number,
  tableIndex: number,
  source: ScoredTable,
): void {
  const existingLayout = page.layouts[layoutIndex];
  const layoutId = existingLayout.layout_id;
  page.layouts[layoutIndex] = {
    ...existingLayout,
    text: source.layout.text || existingLayout.text,
    position: source.layout.position,
    sub_type: source.layout.sub_type || existingLayout.sub_type,
  };
  page.tables[tableIndex] = cloneTableForLayout(source.table, layoutId);
}

function appendTable(page: DocPage, source: ScoredTable): void {
  const layoutId = `fused:${page.layouts.length}:${source.layout.layout_id}`;
  page.layouts.push({
    ...source.layout,
    layout_id: layoutId,
    parent: '',
    children: [],
  });
  page.tables.push(cloneTableForLayout(source.table, layoutId));
}

function findOverlappingTable(
  page: DocPage,
  position: [number, number, number, number],
): { layoutIndex: number; tableIndex: number; score: number } | null {
  let best: { layoutIndex: number; tableIndex: number; score: number; overlap: number } | null = null;

  for (let layoutIndex = 0; layoutIndex < page.layouts.length; layoutIndex++) {
    const layout = page.layouts[layoutIndex];
    if (layout.type !== 'table') continue;
    const overlap = rectOverlapRatio(layout.position, position);
    if (overlap < 0.35 && !hasNearCenter(layout.position, position)) continue;
    const tableIndex = page.tables.findIndex((item) => item.layout_id === layout.layout_id);
    if (tableIndex < 0) continue;
    const score = scoreCreditTable(page.tables[tableIndex].markdown, layout.text);
    if (!best || overlap > best.overlap || (overlap === best.overlap && score > best.score)) {
      best = { layoutIndex, tableIndex, score, overlap };
    }
  }

  return best;
}

function scoreCreditTable(markdown: string, layoutText = ''): number {
  const text = `${markdown}\n${layoutText}`;
  const compact = text.replace(/\s+/g, '');
  let score = 0;

  if (/管理机构|发卡机构|查询机构/.test(compact)) score += 10;
  if (/借款金额|账户授信额度|授信额度|额度/.test(compact)) score += 8;
  if (/账户状态|五级分类|余额|剩余还款期数/.test(compact)) score += 5;
  if (/还款记录|本月应还|本月实还|应还款日|账单日/.test(compact)) score += 4;
  if (/账户\d+|账户[一二三四五六七八九十]+/.test(compact)) score += 4;
  if (/20\d{2}[.年/-]?\d{1,2}[.月/-]?\d{1,2}/.test(compact)) score += 2;
  if (/\d{4,}(?:\.\d+)?/.test(compact)) score += 2;

  const institutionHits = countKnownInstitutionHits(compact);
  if (institutionHits > 0) score += 12 + Math.min(institutionHits - 1, 2) * 3;

  const uncertainMarkers = compact.match(/[■□�]/g)?.length ?? 0;
  score -= Math.min(uncertainMarkers * 4, 12);
  if (compact.length < 40) score -= 8;

  return score;
}

function countKnownInstitutionHits(text: string): number {
  let count = 0;
  for (const alias of KNOWN_INSTITUTION_ALIASES) {
    if (text.includes(alias.replace(/\s+/g, ''))) count++;
    if (count >= 3) break;
  }
  return count;
}

function rectOverlapRatio(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  const ax2 = a[0] + a[2];
  const ay2 = a[1] + a[3];
  const bx2 = b[0] + b[2];
  const by2 = b[1] + b[3];
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a[1], b[1]));
  const intersection = ix * iy;
  const smaller = Math.min(a[2] * a[3], b[2] * b[3]);
  return smaller > 0 ? intersection / smaller : 0;
}

function hasNearCenter(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  const ax = a[0] + a[2] / 2;
  const ay = a[1] + a[3] / 2;
  const bx = b[0] + b[2] / 2;
  const by = b[1] + b[3] / 2;
  const maxDx = Math.max(a[2], b[2]) * 0.35;
  const maxDy = Math.max(a[3], b[3]) * 0.35;
  return Math.abs(ax - bx) <= maxDx && Math.abs(ay - by) <= maxDy;
}

function tableSignature(markdown: string): string {
  return markdown
    .replace(/\s+/g, '')
    .replace(/[|:：,，。.\-—_]/g, '')
    .slice(0, 180);
}

function cloneDocParserResult(doc: DocParserResult): DocParserResult {
  return {
    ...doc,
    pages: doc.pages.map((page) => ({
      ...page,
      layouts: page.layouts.map((layout) => ({ ...layout, children: [...(layout.children ?? [])] })),
      tables: page.tables.map((table) => ({
        ...table,
        cells: (table.cells ?? []).map((cell) => ({ ...cell, position: [...cell.position] })),
        matrix: (table.matrix ?? []).map((row) => [...row]),
      })),
      images: [...(page.images ?? [])],
      meta: { ...page.meta },
    })),
  };
}

function cloneTableForLayout(table: DocTable, layoutId: string): DocTable {
  return {
    ...table,
    layout_id: layoutId,
    cells: (table.cells ?? []).map((cell) => ({
      ...cell,
      layout_id: layoutId,
      position: [...cell.position],
    })),
    matrix: (table.matrix ?? []).map((row) => [...row]),
  };
}
