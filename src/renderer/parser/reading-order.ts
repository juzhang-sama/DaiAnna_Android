import type { DocLayout, DocPage } from '../../shared/doc-parser-types';

const PAGE_NUMBER_PATTERN = /第(\d+)页[，,。./\s]*共(\d+)页/g;

export type ColumnSide = 'left' | 'right';

export interface PageColumnLogicalPages {
  left: number;
  right: number;
  source: 'footer' | 'fallback';
}

interface FooterHit {
  pageNumber: number;
  side: ColumnSide;
  x: number;
  y: number;
  isFooter: boolean;
}

export function getColumnSide(posX: number, pageWidth: number): ColumnSide {
  return posX > pageWidth / 2 ? 'right' : 'left';
}

export function getLayoutLogicalPage(page: DocPage, layout: Pick<DocLayout, 'position'>): number {
  const columnPages = getPageColumnLogicalPages(page);
  const side = getLayoutColumnSide(page, layout);
  return columnPages[side];
}

export function getPageColumnLogicalPages(page: DocPage): PageColumnLogicalPages {
  const fallbackLeft = page.page_num * 2 + 1;
  const fallbackRight = fallbackLeft + 1;
  const pageWidth = page.meta?.page_width ?? 842;
  const footers = assignFooterSides(extractFooterHits(page, pageWidth), pageWidth);
  const leftFooter = pickBestFooter(footers, 'left');
  const rightFooter = pickBestFooter(footers, 'right');

  if (leftFooter && rightFooter) {
    const corrected = correctConsecutiveFooterPages(leftFooter.pageNumber, rightFooter.pageNumber);
    return { ...corrected, source: 'footer' };
  }
  if (leftFooter) {
    return { left: leftFooter.pageNumber, right: leftFooter.pageNumber + 1, source: 'footer' };
  }
  if (rightFooter) {
    return { left: Math.max(1, rightFooter.pageNumber - 1), right: rightFooter.pageNumber, source: 'footer' };
  }

  return { left: fallbackLeft, right: fallbackRight, source: 'fallback' };
}

function correctConsecutiveFooterPages(left: number, right: number): { left: number; right: number } {
  if (right === left + 1) return { left, right };
  if (right > 1 && right > left) return { left: right - 1, right };
  return { left, right: left + 1 };
}

function getLayoutColumnSide(page: DocPage, layout: Pick<DocLayout, 'position'>): ColumnSide {
  const pageWidth = page.meta?.page_width ?? 842;
  const footers = assignFooterSides(extractFooterHits(page, pageWidth), pageWidth);
  const leftFooter = pickBestFooter(footers, 'left');
  const rightFooter = pickBestFooter(footers, 'right');

  if (leftFooter && rightFooter && Math.abs(rightFooter.x - leftFooter.x) > pageWidth * 0.1) {
    const splitX = (leftFooter.x + rightFooter.x) / 2;
    return layout.position[0] > splitX ? 'right' : 'left';
  }

  const inferredSplitX = inferColumnSplitX(page, pageWidth);
  if (inferredSplitX !== null) {
    return layout.position[0] > inferredSplitX ? 'right' : 'left';
  }

  return getColumnSide(layout.position[0], pageWidth);
}

function extractFooterHits(page: DocPage, pageWidth: number): FooterHit[] {
  const hits: FooterHit[] = [];
  for (const layout of page.layouts) {
    if (!layout.text) continue;
    PAGE_NUMBER_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PAGE_NUMBER_PATTERN.exec(layout.text)) !== null) {
      hits.push({
        pageNumber: Number(match[1]),
        side: getColumnSide(layout.position[0], pageWidth),
        x: layout.position[0],
        y: layout.position[1],
        isFooter: layout.type === 'head_tail' || layout.sub_type === 'footer',
      });
    }
  }
  return hits;
}

function assignFooterSides(footers: FooterHit[], pageWidth: number): FooterHit[] {
  if (footers.length < 2) return footers;

  const ranked = [...footers].sort((a, b) =>
    Number(b.isFooter) - Number(a.isFooter) ||
    b.y - a.y ||
    a.x - b.x);
  const distinct = ranked
    .sort((a, b) => a.x - b.x)
    .filter((footer, index, arr) =>
      index === 0 || Math.abs(footer.x - arr[index - 1].x) > pageWidth * 0.05);

  if (distinct.length < 2) return footers;

  const leftX = distinct[0].x;
  const rightX = distinct[distinct.length - 1].x;
  const splitX = (leftX + rightX) / 2;

  return footers.map((footer) => ({
    ...footer,
    side: footer.x > splitX ? 'right' : 'left',
  }));
}

function pickBestFooter(footers: FooterHit[], side: ColumnSide): FooterHit | undefined {
  return footers
    .filter((footer) => footer.side === side)
    .sort((a, b) => Number(b.isFooter) - Number(a.isFooter) || b.y - a.y)[0];
}

function inferColumnSplitX(page: DocPage, pageWidth: number): number | null {
  const intervals = page.layouts
    .filter((layout) => layout.type !== 'head_tail' && layout.sub_type !== 'footer')
    .map((layout) => {
      const [x, , width] = layout.position;
      return { x, right: x + width, width };
    })
    .filter((item) =>
      item.width > pageWidth * 0.015 &&
      item.width < pageWidth * 0.55 &&
      item.x >= 0 &&
      item.right <= pageWidth,
    )
    .sort((a, b) => a.x - b.x);

  if (intervals.length < 4) return null;

  let best: { splitX: number; gap: number } | null = null;
  for (let i = 1; i < intervals.length - 1; i++) {
    const left = intervals.slice(0, i);
    const right = intervals.slice(i);
    if (left.length < 2 || right.length < 2) continue;

    const leftRight = Math.max(...left.map((item) => item.right));
    const rightLeft = Math.min(...right.map((item) => item.x));
    const gap = rightLeft - leftRight;
    const splitX = (leftRight + rightLeft) / 2;

    if (gap < pageWidth * 0.03) continue;
    if (splitX < pageWidth * 0.25 || splitX > pageWidth * 0.75) continue;
    if (!best || gap > best.gap) best = { splitX, gap };
  }

  return best?.splitX ?? null;
}
