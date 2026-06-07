import { TEXTIN_CONFIG } from './textin-config';
import type {
  DocParserResult,
  DocPage,
  DocTable,
  DocLayout,
  DocCell,
  DocPageMeta,
} from '../shared/doc-parser-types';
import { readCache, writeCache } from './doc-parser-cache';

// ─── TextIn 响应类型（基于实际 API 返回结构） ────────

interface TextInCellContent {
  type: string;
  content: number[];
  pos: number[];
}

interface TextInCell {
  row: number;
  col: number;
  row_span: number;
  col_span: number;
  content: TextInCellContent[];
  pos: number[];
}

interface TextInStructuredBlock {
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

/** pages[] 中的每一页 */
interface TextInPageInfo {
  page_id: number;
  height: number;
  width?: number;
  status: string;
  content: TextInLineItem[];
  structured: TextInStructuredBlock[];
}

interface TextInLineItem {
  id: number;
  type: string;
  text: string;
  pos: number[];
  score: number;
  angle: number;
}

interface TextInResponse {
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

// ─── 坐标转换：8点 → [x, y, w, h] ─────────────────

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

// ─── 构建 matrix（二维索引数组） ──────────────────────

function buildMatrix(cells: TextInCell[], rows: number, cols: number): number[][] {
  const matrix: number[][] = Array.from({ length: rows }, () =>
    Array(cols).fill(-1),
  );
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

// ─── 从 cell.content 解析文本 ────────────────────────

/** 从 cell 的嵌套 content 中提取文本，通过 line id 查找 */
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

// ─── HTML 表格 → Markdown 表格 ──────────────────────

/** 将 TextIn 返回的 HTML table 转为 pipe-delimited Markdown */
function htmlTableToMarkdown(html: string): string {
  if (!html || !html.includes('<table')) return html ?? '';

  const rows: string[][] = [];
  // 按 <tr> 拆分行
  const trMatches = html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
  if (!trMatches) return html;

  for (const tr of trMatches) {
    const cells: string[] = [];
    // 匹配 <td> 和 <th>，提取内容
    const tdRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let m: RegExpExecArray | null;
    while ((m = tdRegex.exec(tr)) !== null) {
      // 提取 colspan 用于重复填充，保持历史解析器依赖的合并单元格展开行为。
      const colspanMatch = m[0].match(/colspan="(\d+)"/i);
      const colspan = colspanMatch ? parseInt(colspanMatch[1], 10) : 1;
      // 清理 HTML 标签，<br> 转 \n
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

  // 构建 Markdown
  const lines: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    lines.push('| ' + rows[i].join(' | ') + ' |');
    if (i === 0) {
      lines.push('| ' + rows[i].map(() => '---').join(' | ') + ' |');
    }
  }
  return lines.join('\n');
}

// ─── 转换单个 table block → DocTable ─────────────────

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

  const rowCount = block.rows ?? 0;
  const colCount = block.cols ?? 0;
  const matrix = buildMatrix(tiCells, rowCount, colCount);

  let mergeTable = '';
  if (block.continue === true) {
    mergeTable = 'begin';
  }

  // TextIn 的 block.text 是 HTML 格式，需转为 Markdown
  const markdown = htmlTableToMarkdown(block.text ?? '');

  return {
    layout_id: idPrefix,
    markdown,
    position: posToRect(block.pos),
    cells: docCells,
    matrix,
    merge_table: mergeTable,
  };
}

// ─── 构建 line id → text 映射 ───────────────────────

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

// ─── 从 content 原始行补充页脚到 layouts ──────────────

const FOOTER_PAGE_RE = /第(\d+)页[，,。./\s]*共(\d+)页/;

/** 扫描 content 原始行，将包含页码的页脚文本追加到 layouts */
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
    } as DocLayout);
  }
}

// ─── 转换单页（从 pages[] 读取 structured） ───────────

function convertPage(
  pageInfo: TextInPageInfo,
  pageIdx: number,
): DocPage {
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
      // 兼容历史解析器：layouts 中需要一个 type='table' 的占位元素，
      // layout_id 与 tables 中的对应，供 doc-table-bridge 按 id 关联
      layouts.push({
        layout_id: tableId,
        text: '',
        position: posToRect(block.pos),
        type: 'table',
        sub_type: '',
        parent: '',
        children: [],
      } as DocLayout);
    } else if (block.type === 'header') {
      // skip page headers (报告头部装饰性内容)
    } else {
      layouts.push({
        layout_id: `${idBase}_l${layoutCount++}`,
        text: block.text ?? '',
        position: posToRect(block.pos),
        type: block.type === 'textblock' && block.sub_type === 'text_title' ? 'title' : 'para',
        sub_type: block.sub_type ?? '',
        parent: '',
        children: [],
      } as DocLayout);
    }
  }

  // 从 content 原始行中补充页脚（structured 不包含页脚文本）
  appendFooterFromContent(pageInfo.content, pageIdx, layoutCount, layouts);

  // 估算 width：取所有 line 的最大 x 坐标，或用 height 的常见比例
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

// ─── 调用 TextIn API ────────────────────────────────

async function callTextInApi(fileBuffer: Buffer): Promise<TextInResponse> {
  const url = `${TEXTIN_CONFIG.parseUrl}?dpi=144&remove_watermark=1&paratext_mode=body`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'x-ti-app-id': TEXTIN_CONFIG.appId,
      'x-ti-secret-code': TEXTIN_CONFIG.secretCode,
      'Content-Type': 'application/octet-stream',
    },
    body: new Uint8Array(fileBuffer),
  });

  if (!resp.ok) {
    throw new Error(`textin api request failed: ${resp.status}`);
  }

  const data = await resp.json();

  if (data.code !== 200) {
    throw new Error(`textin error: ${data.code} ${data.message}`);
  }

  return data as TextInResponse;
}

// ─── 响应转换 → DocParserResult ─────────────────────

function convertResponse(
  tiResp: TextInResponse,
  fileName: string,
): DocParserResult {
  const { pages } = tiResp.result;

  const docPages: DocPage[] = [];
  for (let i = 0; i < (pages?.length ?? 0); i++) {
    docPages.push(convertPage(pages[i], i));
  }

  return {
    file_name: fileName,
    file_id: '',
    pages: docPages,
  };
}

// ─── 对外接口 ───────────────────────────────────────

/**
 * 使用 TextIn 解析 PDF/图片文档。
 * 返回统一的 DocParserResult，供渲染进程复用既有表格解析链路。
 */
export async function parseDocument(
  fileBase64: string,
  fileName: string,
): Promise<DocParserResult> {
  const cached = await readCache(fileBase64);
  if (cached) return cached;

  const fileBuffer = Buffer.from(fileBase64, 'base64');
  const tiResp = await callTextInApi(fileBuffer);
  const result = convertResponse(tiResp, fileName);

  await writeCache(fileBase64, result);
  return result;
}
