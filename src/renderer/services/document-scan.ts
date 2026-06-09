export type DocumentScanLevel = 'pass' | 'warn' | 'reject';

export interface ScanPoint {
  x: number;
  y: number;
}

export interface DocumentScanMetrics {
  detected: boolean;
  coverage: number;
  aspectRatio: number;
  skew: number;
}

export interface DocumentScanPreviewResult {
  level: DocumentScanLevel;
  score: number;
  issues: string[];
  corners: ScanPoint[] | null;
  metrics: DocumentScanMetrics;
}

export interface DocumentScanResult extends DocumentScanPreviewResult {
  correctedCanvas: HTMLCanvasElement;
  enhancedCanvas: HTMLCanvasElement;
  outputCanvas: HTMLCanvasElement;
}

interface AnalysisImage {
  width: number;
  height: number;
  scale: number;
  gray: Uint8ClampedArray;
  mask: Uint8Array;
}

interface Component {
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  mask: Uint8Array;
}

interface LineYX {
  a: number;
  b: number;
}

interface LineXY {
  a: number;
  b: number;
}

const A4_RATIO = Math.SQRT2;
const ANALYSIS_MAX_SIDE = 760;
const OUTPUT_LONG_SIDE = 2400;
const MIN_COMPONENT_COVERAGE = 0.16;

export function scanDocumentCanvas(source: HTMLCanvasElement): DocumentScanResult {
  const preview = analyzeDocumentCanvas(source);

  if (!preview.corners) {
    return buildRejectedResult(source, preview);
  }

  const correctedCanvas = warpDocument(source, preview.corners);
  const enhancedCanvas = enhanceDocumentCanvas(correctedCanvas);

  return {
    ...preview,
    correctedCanvas,
    enhancedCanvas,
    outputCanvas: enhancedCanvas,
  };
}

export function analyzeDocumentCanvas(source: HTMLCanvasElement): DocumentScanPreviewResult {
  const analysis = buildAnalysisImage(source);
  const component = findLargestComponent(analysis);

  if (!component) {
    return buildRejectedPreview(['未检测到完整纸张边缘']);
  }

  let corners = detectDocumentCorners(component, analysis.width, analysis.height);
  if (!corners) {
    return buildRejectedPreview(['纸张边缘不完整']);
  }
  if (!isPlausibleDocumentCorners(corners)) {
    const bboxCorners = componentBoxCorners(component);
    corners = isPlausibleDocumentCorners(bboxCorners) ? bboxCorners : null;
  }
  if (!corners) {
    return buildRejectedPreview(['纸张边缘不完整']);
  }

  const sourceCorners = corners.map((point) => ({
    x: point.x / analysis.scale,
    y: point.y / analysis.scale,
  }));
  const metrics = measureDocument(source, sourceCorners, component.area / (analysis.width * analysis.height));
  const issues = buildScanIssues(metrics, sourceCorners, source.width, source.height);
  const score = scoreScan(metrics, issues);
  const level: DocumentScanLevel = score < 55 || issues.some(isRejectIssue)
    ? 'reject'
    : score < 78 || issues.length > 0
      ? 'warn'
      : 'pass';

  return {
    level,
    score,
    issues,
    corners: sourceCorners,
    metrics,
  };
}

export function isPlausibleDocumentCorners(corners: ScanPoint[] | null): boolean {
  if (!corners || corners.length !== 4) return false;
  if (corners.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return false;

  const top = distance(corners[0], corners[1]);
  const right = distance(corners[1], corners[2]);
  const bottom = distance(corners[2], corners[3]);
  const left = distance(corners[3], corners[0]);
  const horizontal = (top + bottom) / 2;
  const vertical = (left + right) / 2;
  const edges = [top, right, bottom, left];
  const minEdge = Math.min(...edges);
  const maxEdge = Math.max(...edges);
  const topBottomRatio = Math.min(top, bottom) / Math.max(top, bottom, 1);
  const leftRightRatio = Math.min(left, right) / Math.max(left, right, 1);
  const portraitRatio = vertical / Math.max(1, horizontal);
  const bboxArea = Math.max(1, horizontal * vertical);
  const areaFill = polygonArea(corners) / bboxArea;

  return minEdge / Math.max(1, maxEdge) >= 0.24 &&
    topBottomRatio >= 0.35 &&
    leftRightRatio >= 0.35 &&
    portraitRatio >= 0.42 &&
    portraitRatio <= 2.35 &&
    areaFill >= 0.52;
}

function buildAnalysisImage(source: HTMLCanvasElement): AnalysisImage {
  const scale = Math.min(1, ANALYSIS_MAX_SIDE / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法分析拍摄画面');
  ctx.drawImage(source, 0, 0, width, height);

  const { data } = ctx.getImageData(0, 0, width, height);
  const gray = new Uint8ClampedArray(width * height);
  const saturation = new Float32Array(width * height);
  const hist = new Array<number>(256).fill(0);

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const value = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    gray[p] = value;
    saturation[p] = max === 0 ? 0 : (max - min) / max;
    hist[value]++;
  }

  const threshold = Math.max(112, Math.min(215, otsuThreshold(hist, width * height) + 16));
  const rawMask = new Uint8Array(width * height);
  for (let p = 0; p < gray.length; p++) {
    rawMask[p] = gray[p] >= threshold && (gray[p] >= 168 || saturation[p] <= 0.36) ? 1 : 0;
  }

  const closed = erodeMask(dilateMask(rawMask, width, height, 2), width, height, 2);
  const mask = dilateMask(closed, width, height, 1);
  return { width, height, scale, gray, mask };
}

function otsuThreshold(hist: number[], total: number): number {
  let sum = 0;
  for (let i = 0; i < hist.length; i++) sum += i * hist[i];

  let sumB = 0;
  let wB = 0;
  let maxVariance = 0;
  let threshold = 150;

  for (let i = 0; i < hist.length; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;

    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const variance = wB * wF * (mB - mF) ** 2;
    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = i;
    }
  }

  return threshold;
}

function dilateMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const result = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = 0;
      for (let dy = -radius; dy <= radius && !value; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < width && mask[yy * width + xx]) {
            value = 1;
            break;
          }
        }
      }
      result[y * width + x] = value;
    }
  }
  return result;
}

function erodeMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const result = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = 1;
      for (let dy = -radius; dy <= radius && value; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) {
          value = 0;
          break;
        }
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width || !mask[yy * width + xx]) {
            value = 0;
            break;
          }
        }
      }
      result[y * width + x] = value;
    }
  }
  return result;
}

function findLargestComponent(analysis: AnalysisImage): Component | null {
  const { width, height, mask } = analysis;
  const total = width * height;
  const visited = new Uint8Array(total);
  const stack = new Int32Array(total);
  let best: Component | null = null;

  for (let start = 0; start < total; start++) {
    if (!mask[start] || visited[start]) continue;

    let top = 0;
    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    const componentMask = new Uint8Array(total);
    visited[start] = 1;
    stack[top++] = start;

    while (top > 0) {
      const idx = stack[--top];
      componentMask[idx] = 1;
      area++;

      const x = idx % width;
      const y = Math.floor(idx / width);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      addNeighbor(idx - 1, x > 0);
      addNeighbor(idx + 1, x < width - 1);
      addNeighbor(idx - width, y > 0);
      addNeighbor(idx + width, y < height - 1);
    }

    const coverage = area / total;
    if (coverage >= MIN_COMPONENT_COVERAGE && (!best || scoreComponent(area, minX, minY, maxX, maxY, width, height) > scoreComponent(best.area, best.minX, best.minY, best.maxX, best.maxY, width, height))) {
      best = { area, minX, minY, maxX, maxY, mask: componentMask };
    }

    function addNeighbor(idx: number, valid: boolean): void {
      if (!valid || visited[idx] || !mask[idx]) return;
      visited[idx] = 1;
      stack[top++] = idx;
    }
  }

  return best;
}

function scoreComponent(area: number, minX: number, minY: number, maxX: number, maxY: number, width: number, height: number): number {
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const centerDistance = Math.hypot(cx - width / 2, cy - height / 2) / Math.hypot(width / 2, height / 2);
  const bboxArea = Math.max(1, (maxX - minX + 1) * (maxY - minY + 1));
  const solidity = area / bboxArea;
  return area * (1 - centerDistance * 0.32) * Math.min(1.25, 0.75 + solidity);
}

function detectDocumentCorners(component: Component, width: number, height: number): ScanPoint[] | null {
  const topPoints: ScanPoint[] = [];
  const bottomPoints: ScanPoint[] = [];
  const leftPoints: ScanPoint[] = [];
  const rightPoints: ScanPoint[] = [];
  const { minX, minY, maxX, maxY, mask } = component;

  for (let x = minX; x <= maxX; x += 2) {
    let top = -1;
    let bottom = -1;
    for (let y = minY; y <= maxY; y++) {
      if (mask[y * width + x]) {
        top = y;
        break;
      }
    }
    for (let y = maxY; y >= minY; y--) {
      if (mask[y * width + x]) {
        bottom = y;
        break;
      }
    }
    if (top >= 0) topPoints.push({ x, y: top });
    if (bottom >= 0) bottomPoints.push({ x, y: bottom });
  }

  for (let y = minY; y <= maxY; y += 2) {
    let left = -1;
    let right = -1;
    for (let x = minX; x <= maxX; x++) {
      if (mask[y * width + x]) {
        left = x;
        break;
      }
    }
    for (let x = maxX; x >= minX; x--) {
      if (mask[y * width + x]) {
        right = x;
        break;
      }
    }
    if (left >= 0) leftPoints.push({ x: left, y });
    if (right >= 0) rightPoints.push({ x: right, y });
  }

  if (topPoints.length < 8 || bottomPoints.length < 8 || leftPoints.length < 8 || rightPoints.length < 8) {
    return fallbackCorners(component, width);
  }

  const top = robustFitYX(topPoints);
  const bottom = robustFitYX(bottomPoints);
  const left = robustFitXY(leftPoints);
  const right = robustFitXY(rightPoints);
  if (!top || !bottom || !left || !right) return fallbackCorners(component, width);

  const corners = [
    intersect(top, left),
    intersect(top, right),
    intersect(bottom, right),
    intersect(bottom, left),
  ];

  if (corners.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    return fallbackCorners(component, width);
  }

  return corners.map((point) => ({
    x: clamp(point.x, 0, width - 1),
    y: clamp(point.y, 0, height - 1),
  }));
}

function fallbackCorners(component: Component, width: number): ScanPoint[] | null {
  let tl: ScanPoint | null = null;
  let tr: ScanPoint | null = null;
  let br: ScanPoint | null = null;
  let bl: ScanPoint | null = null;
  let tlScore = Infinity;
  let trScore = -Infinity;
  let brScore = -Infinity;
  let blScore = Infinity;

  for (let y = component.minY; y <= component.maxY; y++) {
    for (let x = component.minX; x <= component.maxX; x++) {
      if (!component.mask[y * width + x]) continue;
      const sum = x + y;
      const diff = x - y;
      if (sum < tlScore) {
        tlScore = sum;
        tl = { x, y };
      }
      if (diff > trScore) {
        trScore = diff;
        tr = { x, y };
      }
      if (sum > brScore) {
        brScore = sum;
        br = { x, y };
      }
      if (diff < blScore) {
        blScore = diff;
        bl = { x, y };
      }
    }
  }

  return tl && tr && br && bl ? [tl, tr, br, bl] : null;
}

function componentBoxCorners(component: Component): ScanPoint[] {
  return [
    { x: component.minX, y: component.minY },
    { x: component.maxX, y: component.minY },
    { x: component.maxX, y: component.maxY },
    { x: component.minX, y: component.maxY },
  ];
}

function robustFitYX(points: ScanPoint[]): LineYX | null {
  return robustFit(points, false) as LineYX | null;
}

function robustFitXY(points: ScanPoint[]): LineXY | null {
  return robustFit(points, true) as LineXY | null;
}

function robustFit(points: ScanPoint[], swap: boolean): LineYX | LineXY | null {
  if (points.length < 2) return null;
  const initialLine = fit(points, swap);
  if (!initialLine) return null;

  const residuals = points.map((point) => Math.abs((swap ? point.x : point.y) - (initialLine.a * (swap ? point.y : point.x) + initialLine.b)));
  const sorted = [...residuals].sort((a, b) => a - b);
  const threshold = Math.max(3, sorted[Math.floor(sorted.length * 0.68)] ?? 3);
  const filtered = points.filter((_, index) => residuals[index] <= threshold);
  return fit(filtered.length >= 2 ? filtered : points, swap);
}

function fit(points: ScanPoint[], swap: boolean): LineYX | LineXY | null {
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  const n = points.length;

  for (const point of points) {
    const x = swap ? point.y : point.x;
    const y = swap ? point.x : point.y;
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumXY += x * y;
  }

  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-6) return null;
  const a = (n * sumXY - sumX * sumY) / denom;
  const b = (sumY - a * sumX) / n;
  return { a, b };
}

function intersect(yLine: LineYX, xLine: LineXY): ScanPoint {
  const denom = 1 - xLine.a * yLine.a;
  if (Math.abs(denom) < 1e-6) return { x: NaN, y: NaN };
  const x = (xLine.a * yLine.b + xLine.b) / denom;
  const y = yLine.a * x + yLine.b;
  return { x, y };
}

function measureDocument(source: HTMLCanvasElement, corners: ScanPoint[], coverage: number): DocumentScanMetrics {
  const top = distance(corners[0], corners[1]);
  const right = distance(corners[1], corners[2]);
  const bottom = distance(corners[2], corners[3]);
  const left = distance(corners[3], corners[0]);
  const width = (top + bottom) / 2;
  const height = (left + right) / 2;
  const aspectRatio = Math.max(width, height) / Math.max(1, Math.min(width, height));
  const edgeMismatch = Math.max(
    Math.abs(top - bottom) / Math.max(top, bottom, 1),
    Math.abs(left - right) / Math.max(left, right, 1),
  );
  const areaRatio = polygonArea(corners) / Math.max(1, source.width * source.height);
  return {
    detected: true,
    coverage: Math.max(coverage, areaRatio),
    aspectRatio,
    skew: edgeMismatch,
  };
}

function buildScanIssues(metrics: DocumentScanMetrics, corners: ScanPoint[], width: number, height: number): string[] {
  const issues: string[] = [];
  if (metrics.coverage < 0.26) {
    issues.push('纸张离取景框太远');
  } else if (metrics.coverage < 0.38) {
    issues.push('纸张占画面偏小');
  }

  const aspectOffset = Math.abs(metrics.aspectRatio - A4_RATIO);
  if (aspectOffset > 0.46) {
    issues.push('纸张比例异常');
  } else if (aspectOffset > 0.3) {
    issues.push('A4 比例偏差较大');
  }

  if (metrics.skew > 0.48) {
    issues.push('拍摄角度偏斜，已尝试校正');
  } else if (metrics.skew > 0.34) {
    issues.push('拍摄角度略斜，已尝试校正');
  }

  const minMargin = Math.min(...corners.map((point) => Math.min(point.x, point.y, width - point.x, height - point.y)));
  if (minMargin < Math.min(width, height) * 0.006) {
    issues.push('纸张边缘可能被裁切');
  }

  return issues;
}

function scoreScan(metrics: DocumentScanMetrics, issues: string[]): number {
  let score = 100;
  if (metrics.coverage < 0.26) score -= 36;
  else if (metrics.coverage < 0.38) score -= 10;
  score -= Math.min(20, Math.abs(metrics.aspectRatio - A4_RATIO) * 55);
  score -= Math.min(14, metrics.skew * 25);
  if (issues.includes('纸张边缘可能被裁切')) score -= 6;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function isRejectIssue(issue: string): boolean {
  return issue === '纸张离取景框太远' ||
    issue === '纸张比例异常';
}

function warpDocument(source: HTMLCanvasElement, corners: ScanPoint[]): HTMLCanvasElement {
  const top = distance(corners[0], corners[1]);
  const right = distance(corners[1], corners[2]);
  const bottom = distance(corners[2], corners[3]);
  const left = distance(corners[3], corners[0]);
  const measuredWidth = (top + bottom) / 2;
  const measuredHeight = (left + right) / 2;
  const portrait = measuredHeight >= measuredWidth;
  const longSide = Math.min(OUTPUT_LONG_SIDE, Math.max(measuredWidth, measuredHeight));
  const outputWidth = Math.round(portrait ? longSide / A4_RATIO : longSide);
  const outputHeight = Math.round(portrait ? longSide : longSide / A4_RATIO);
  const dst = [
    { x: 0, y: 0 },
    { x: outputWidth - 1, y: 0 },
    { x: outputWidth - 1, y: outputHeight - 1 },
    { x: 0, y: outputHeight - 1 },
  ];
  const transform = solvePerspectiveTransform(dst, corners);
  const srcCtx = source.getContext('2d');
  if (!srcCtx) throw new Error('无法读取拍摄画面');
  const srcImage = srcCtx.getImageData(0, 0, source.width, source.height);
  const output = document.createElement('canvas');
  output.width = outputWidth;
  output.height = outputHeight;
  const outCtx = output.getContext('2d');
  if (!outCtx) throw new Error('无法生成扫描画面');
  const outImage = outCtx.createImageData(outputWidth, outputHeight);

  for (let y = 0; y < outputHeight; y++) {
    for (let x = 0; x < outputWidth; x++) {
      const sourcePoint = applyPerspective(transform, x, y);
      sampleBilinear(srcImage, source.width, source.height, sourcePoint.x, sourcePoint.y, outImage.data, (y * outputWidth + x) * 4);
    }
  }

  outCtx.putImageData(outImage, 0, 0);
  return output;
}

function solvePerspectiveTransform(from: ScanPoint[], to: ScanPoint[]): number[] {
  const matrix = new Array<number[]>(8);
  const rhs = new Array<number>(8);

  for (let i = 0; i < 4; i++) {
    const x = from[i].x;
    const y = from[i].y;
    const u = to[i].x;
    const v = to[i].y;
    matrix[i * 2] = [x, y, 1, 0, 0, 0, -u * x, -u * y];
    rhs[i * 2] = u;
    matrix[i * 2 + 1] = [0, 0, 0, x, y, 1, -v * x, -v * y];
    rhs[i * 2 + 1] = v;
  }

  return gaussianSolve(matrix, rhs);
}

function gaussianSolve(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
    }
    [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
    [rhs[col], rhs[pivot]] = [rhs[pivot], rhs[col]];

    const divisor = matrix[col][col] || 1e-9;
    for (let j = col; j < n; j++) matrix[col][j] /= divisor;
    rhs[col] /= divisor;

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = matrix[row][col];
      for (let j = col; j < n; j++) matrix[row][j] -= factor * matrix[col][j];
      rhs[row] -= factor * rhs[col];
    }
  }
  return rhs;
}

function applyPerspective(transform: number[], x: number, y: number): ScanPoint {
  const denom = transform[6] * x + transform[7] * y + 1;
  return {
    x: (transform[0] * x + transform[1] * y + transform[2]) / denom,
    y: (transform[3] * x + transform[4] * y + transform[5]) / denom,
  };
}

function sampleBilinear(
  image: ImageData,
  width: number,
  height: number,
  x: number,
  y: number,
  out: Uint8ClampedArray,
  outIndex: number,
): void {
  const sx = clamp(x, 0, width - 1);
  const sy = clamp(y, 0, height - 1);
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const dx = sx - x0;
  const dy = sy - y0;
  const data = image.data;

  for (let channel = 0; channel < 4; channel++) {
    const p00 = data[(y0 * width + x0) * 4 + channel];
    const p10 = data[(y0 * width + x1) * 4 + channel];
    const p01 = data[(y1 * width + x0) * 4 + channel];
    const p11 = data[(y1 * width + x1) * 4 + channel];
    const top = p00 * (1 - dx) + p10 * dx;
    const bottom = p01 * (1 - dx) + p11 * dx;
    out[outIndex + channel] = top * (1 - dy) + bottom * dy;
  }
}

function enhanceDocumentCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法增强扫描画面');
  ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = image;
  const hist = new Array<number>(256).fill(0);
  const gray = new Float32Array(canvas.width * canvas.height);
  const corrected = new Float32Array(canvas.width * canvas.height);
  let graySum = 0;

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const value = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    gray[p] = value;
    graySum += value;
  }

  const background = boxBlur(gray, canvas.width, canvas.height, Math.max(16, Math.round(Math.min(canvas.width, canvas.height) * 0.024)));
  const averageBackground = graySum / Math.max(1, gray.length);
  for (let p = 0; p < gray.length; p++) {
    const value = clamp(gray[p] + (averageBackground - background[p]) * 0.68, 0, 255);
    corrected[p] = value;
    hist[Math.round(value)]++;
  }

  const low = percentileFromHist(hist, corrected.length, 0.025);
  const high = Math.max(low + 42, percentileFromHist(hist, corrected.length, 0.982));

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    let value = ((corrected[p] - low) / (high - low)) * 255;
    value = Math.pow(clamp(value, 0, 255) / 255, 0.9) * 255;
    const sharpened = value + 0.1 * laplacianAt(corrected, canvas.width, canvas.height, p);
    const output = clamp(sharpened, 0, 255);
    data[i] = output;
    data[i + 1] = output;
    data[i + 2] = output;
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

function boxBlur(values: Float32Array, width: number, height: number, radius: number): Float32Array {
  const temp = new Float32Array(values.length);
  const output = new Float32Array(values.length);
  const diameter = radius * 2 + 1;

  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let dx = -radius; dx <= radius; dx++) {
      sum += values[y * width + clamp(Math.round(dx), 0, width - 1)];
    }
    for (let x = 0; x < width; x++) {
      temp[y * width + x] = sum / diameter;
      const removeX = clamp(x - radius, 0, width - 1);
      const addX = clamp(x + radius + 1, 0, width - 1);
      sum += values[y * width + addX] - values[y * width + removeX];
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      sum += temp[clamp(Math.round(dy), 0, height - 1) * width + x];
    }
    for (let y = 0; y < height; y++) {
      output[y * width + x] = sum / diameter;
      const removeY = clamp(y - radius, 0, height - 1);
      const addY = clamp(y + radius + 1, 0, height - 1);
      sum += temp[addY * width + x] - temp[removeY * width + x];
    }
  }

  return output;
}

function percentileFromHist(hist: number[], total: number, percentile: number): number {
  const target = total * percentile;
  let seen = 0;
  for (let i = 0; i < hist.length; i++) {
    seen += hist[i];
    if (seen >= target) return i;
  }
  return hist.length - 1;
}

function laplacianAt(gray: Uint8ClampedArray | Float32Array, width: number, height: number, index: number): number {
  const x = index % width;
  const y = Math.floor(index / width);
  if (x === 0 || y === 0 || x === width - 1 || y === height - 1) return 0;
  return 4 * gray[index] - gray[index - 1] - gray[index + 1] - gray[index - width] - gray[index + width];
}

function buildRejectedPreview(issues: string[]): DocumentScanPreviewResult {
  return {
    level: 'reject',
    score: 0,
    issues,
    corners: null,
    metrics: {
      detected: false,
      coverage: 0,
      aspectRatio: 0,
      skew: 0,
    },
  };
}

function buildRejectedResult(source: HTMLCanvasElement, preview: DocumentScanPreviewResult): DocumentScanResult {
  const outputCanvas = cloneCanvas(source);
  return {
    ...preview,
    correctedCanvas: outputCanvas,
    enhancedCanvas: outputCanvas,
    outputCanvas,
  };
}

function cloneCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法复制拍摄画面');
  ctx.drawImage(source, 0, 0);
  return canvas;
}

function polygonArea(points: ScanPoint[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const next = points[(i + 1) % points.length];
    area += points[i].x * next.y - next.x * points[i].y;
  }
  return Math.abs(area) / 2;
}

function distance(a: ScanPoint, b: ScanPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
