import type {
  DocCell,
  DocLayout,
  DocPage,
  DocPageMeta,
  DocParserResult,
  DocTable,
} from './doc-parser-types';

export interface TextInCellContent {
  type: string;
  content: number[];
  pos: number[];
}

export interface TextInCell {
  row: number;
  col: number;
  row_span: number;
  col_span: number;
  content: TextInCellContent[];
  pos: number[];
}

export interface TextInStructuredBlock {
  type: string;
  sub_type?: string;
  pos: number[];
  text?: string;
  content?: unknown;
  outline_level?: number;
  rows?: number;
  cols?: number;
  cells?: TextInCell[];
  continue?: boolean;
  blocks?: TextInStructuredBlock[];
}

export interface TextInLineItem {
  id: number;
  type: string;
  text: string;
  pos: number[];
  score: number;
  angle: number;
}

export interface TextInPageInfo {
  page_id: number;
  height: number;
  width?: number;
  status: string;
  content: TextInLineItem[];
  structured: TextInStructuredBlock[];
}

export interface TextInResponse {
  code: number;
  message: string;
  result: {
    markdown: string;
    detail: unknown[];
    pages: TextInPageInfo[];
    total_page_number: number;
    valid_page_number: number;
  };
}

const FOOTER_PAGE_RE = /第(\d+)页[，,。./\s]*共(\d+)页/;

function posToRect(pos: number[]): [number, number, number, number] {
  if (!pos || pos.length < 8) return [0, 0, 0, 0];
  const xs = [pos[0], pos[2], pos[4], pos[6]];
  const ys = [pos[1], pos[3], pos[5], pos[7]];
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return [minX, minY, maxX - minX, maxY - minY];
}

function buildMatrix(cells: TextInCell[], rows: number, cols: number): number[][] {
  const matrix: number[][] = Array.from({ length: rows }, () => Array(cols).fill(-1));
  cells.forEach((cell, idx) => {
    for (let r = cell.row; r < cell.row + cell.row_span; r++) {
      for (let c = cell.col; c < cell.col + cell.col_span; c++) {
        if (r < rows && c < cols) {
          matrix[r][c] = idx;
        }
      }
    }
  });
  return matrix;
}

function extractCellText(
  cellContent: TextInCellContent[],
  lineMap: Map<number, string>,
): string {
  if (!Array.isArray(cellContent)) return '';
  const parts: string[] = [];
  for (const block of cellContent) {
    if (block.content && Array.isArray(block.content)) {
      for (const lineId of block.content) {
        const text = lineMap.get(lineId);
        if (text) parts.push(text);
      }
    }
  }
  return parts.join('\n');
}

function htmlTableToMarkdown(html: string): string {
  if (!html || !html.includes('<table')) return html ?? '';

  const rows: string[][] = [];
  const trMatches = html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
  if (!trMatches) return html;

  for (const tr of trMatches) {
    const cells: string[] = [];
    const tdRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let m: RegExpExecArray | null;
    while ((m = tdRegex.exec(tr)) !== null) {
      const colspanMatch = m[0].match(/colspan="(\d+)"/i);
      const colspan = colspanMatch ? parseInt(colspanMatch[1], 10) : 1;
      const text = m[1]
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .trim();
      for (let i = 0; i < colspan; i++) {
        cells.push(text);
      }
    }
    if (cells.length > 0) rows.push(cells);
  }

  if (rows.length === 0) return html;

  const lines: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    lines.push(`| ${rows[i].join(' | ')} |`);
    if (i === 0) {
      lines.push(`| ${rows[i].map(() => '---').join(' | ')} |`);
    }
  }
  return lines.join('\n');
}

function convertTable(
  block: TextInStructuredBlock,
  idPrefix: string,
  lineMap: Map<number, string>,
): DocTable {
  const tiCells = block.cells ?? [];
  const docCells: DocCell[] = tiCells.map((c, i) => ({
    layout_id: `${idPrefix}_cell_${i}`,
    text: extractCellText(c.content, lineMap),
    position: posToRect(c.pos),
    type: 'table_cell',
    sub_type: '',
  }));

  return {
    layout_id: idPrefix,
    markdown: htmlTableToMarkdown(block.text ?? ''),
    position: posToRect(block.pos),
    cells: docCells,
    matrix: buildMatrix(tiCells, block.rows ?? 0, block.cols ?? 0),
    merge_table: block.continue === true ? 'begin' : '',
  };
}

function buildLineMap(content: TextInLineItem[]): Map<number, string> {
  const map = new Map<number, string>();
  if (!Array.isArray(content)) return map;
  for (const line of content) {
    if (line.type === 'line' && line.id !== undefined) {
      map.set(line.id, line.text ?? '');
    }
  }
  return map;
}

function appendFooterFromContent(
  content: TextInLineItem[],
  pageIdx: number,
  startIdx: number,
  layouts: DocLayout[],
): void {
  if (!Array.isArray(content)) return;
  let idx = startIdx;
  for (const line of content) {
    if (line.type !== 'line') continue;
    if (!FOOTER_PAGE_RE.test(line.text ?? '')) continue;
    layouts.push({
      layout_id: `p${pageIdx}_footer${idx++}`,
      text: line.text,
      position: posToRect(line.pos),
      type: 'para',
      sub_type: 'footer',
      parent: '',
      children: [],
    });
  }
}

function convertPage(pageInfo: TextInPageInfo, pageIdx: number): DocPage {
  const tables: DocTable[] = [];
  const layouts: DocLayout[] = [];
  let tableCount = 0;
  let layoutCount = 0;
  const lineMap = buildLineMap(pageInfo.content);

  for (const block of (pageInfo.structured ?? [])) {
    const idBase = `p${pageIdx}`;
    if (block.type === 'table') {
      const tableId = `${idBase}_t${tableCount++}`;
      tables.push(convertTable(block, tableId, lineMap));
      layouts.push({
        layout_id: tableId,
        text: '',
        position: posToRect(block.pos),
        type: 'table',
        sub_type: '',
        parent: '',
        children: [],
      });
    } else if (block.type !== 'header') {
      layouts.push({
        layout_id: `${idBase}_l${layoutCount++}`,
        text: block.text ?? '',
        position: posToRect(block.pos),
        type: block.type === 'textblock' && block.sub_type === 'text_title' ? 'title' : 'para',
        sub_type: block.sub_type ?? '',
        parent: '',
        children: [],
      });
    }
  }

  appendFooterFromContent(pageInfo.content, pageIdx, layoutCount, layouts);

  const estimatedWidth = pageInfo.width ?? Math.round((pageInfo.height ?? 1190) * 1.414);
  const meta: DocPageMeta = {
    page_width: estimatedWidth,
    page_height: pageInfo.height ?? 1190,
    is_scan: true,
    page_angle: 0,
    page_type: 'scan',
  };

  return {
    page_id: String(pageInfo.page_id ?? pageIdx),
    page_num: pageIdx,
    text: '',
    layouts,
    tables,
    images: [],
    meta,
  };
}

export function convertTextInResponse(
  response: TextInResponse,
  fileName: string,
): DocParserResult {
  const pages = response.result.pages ?? [];
  return {
    file_name: fileName,
    file_id: '',
    pages: pages.map((page, index) => convertPage(page, index)),
  };
}
