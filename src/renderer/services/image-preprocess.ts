/**
 * 扫描件图像预处理 — 提升 OCR 输入质量
 *
 * 处理链：灰度化 → 对比度增强 → 二值化 → 去噪
 * 在 canvas 上操作像素，无需额外依赖
 */

/** 预处理配置 */
export interface PreprocessOptions {
  /** 对比度增强系数，1.0 = 不变，>1 增强 */
  contrast: number;
  /** 二值化阈值（0-255），低于此值变黑，高于变白 */
  binaryThreshold: number;
  /** 是否用 Otsu 自动阈值替代固定阈值 */
  adaptiveThreshold: boolean;
  /** 是否二值化。拍照预览/入库建议关闭，OCR 候选可开启 */
  binarize: boolean;
  /** 是否启用去噪（中值滤波） */
  denoise: boolean;
  /** 是否做阴影校正，适合暗光拍摄的纸质报告 */
  shadowCorrection: boolean;
  /** 锐化强度，0 = 不锐化 */
  sharpen: number;
}

const DEFAULT_OPTIONS: PreprocessOptions = {
  contrast: 1.5,
  binaryThreshold: 160,
  adaptiveThreshold: false,
  binarize: true,
  denoise: true,
  shadowCorrection: false,
  sharpen: 0,
};

export function preprocessCanvas(
  source: HTMLCanvasElement,
  options?: Partial<PreprocessOptions>,
): HTMLCanvasElement {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to preprocess image');
  ctx.drawImage(source, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  applyPreprocessPipeline(imageData, opts);
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * 对 base64 图片做预处理，返回处理后的 base64（不含 data: 前缀）
 * 输入输出格式与 pdf-to-image.ts 的 renderPageToBase64 一致
 */
export async function preprocessImage(
  imageBase64: string,
  options?: Partial<PreprocessOptions>,
): Promise<string> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const img = await loadImage(imageBase64);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;

  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  applyPreprocessPipeline(imageData, opts);

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png').replace(/^data:image\/\w+;base64,/, '');
}

/** 加载 base64 为 HTMLImageElement */
function applyPreprocessPipeline(imageData: ImageData, opts: PreprocessOptions): void {
  const { data } = imageData;

  applyGrayscale(data);
  if (opts.shadowCorrection) {
    applyShadowCorrection(data, imageData.width, imageData.height);
  }
  applyContrast(data, opts.contrast);
  if (opts.sharpen > 0) {
    applySharpen(data, imageData.width, imageData.height, opts.sharpen);
  }
  if (opts.binarize) {
    applyBinarize(data, opts.adaptiveThreshold ? calculateOtsuThreshold(data) : opts.binaryThreshold);
  }

  if (opts.denoise) {
    applyMedianFilter(imageData);
  }
}

function loadImage(base64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    const prefix = base64.startsWith('data:') ? '' : 'data:image/png;base64,';
    img.src = `${prefix}${base64}`;
  });
}

/** 灰度化：R=G=B=加权平均 */
function applyGrayscale(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    data[i] = data[i + 1] = data[i + 2] = gray;
  }
}

/** 对比度增强：以 128 为中心拉伸 */
function applyContrast(data: Uint8ClampedArray, factor: number): void {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp((data[i] - 128) * factor + 128);
    data[i + 1] = clamp((data[i + 1] - 128) * factor + 128);
    data[i + 2] = clamp((data[i + 2] - 128) * factor + 128);
  }
}

function applyShadowCorrection(data: Uint8ClampedArray, width: number, height: number): void {
  const gray = new Float32Array(width * height);
  let sum = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = data[i];
    sum += gray[p];
  }

  const background = boxBlur(gray, width, height, Math.max(12, Math.round(Math.min(width, height) * 0.025)));
  const average = sum / Math.max(1, gray.length);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const value = clamp(gray[p] + (average - background[p]) * 0.7);
    data[i] = data[i + 1] = data[i + 2] = value;
  }
}

function applySharpen(data: Uint8ClampedArray, width: number, height: number, amount: number): void {
  const copy = new Uint8ClampedArray(data);
  const strength = Math.max(0, Math.min(0.8, amount));

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      const center = copy[idx];
      const laplacian = 4 * center -
        copy[idx - 4] -
        copy[idx + 4] -
        copy[idx - width * 4] -
        copy[idx + width * 4];
      const value = clamp(center + laplacian * strength);
      data[idx] = data[idx + 1] = data[idx + 2] = value;
    }
  }
}

/** 二值化：低于阈值变黑，高于变白 */
function applyBinarize(data: Uint8ClampedArray, threshold: number): void {
  for (let i = 0; i < data.length; i += 4) {
    const val = data[i] >= threshold ? 255 : 0;
    data[i] = data[i + 1] = data[i + 2] = val;
  }
}

function calculateOtsuThreshold(data: Uint8ClampedArray): number {
  const hist = new Array<number>(256).fill(0);
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    hist[data[i]]++;
    total++;
  }

  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];

  let sumB = 0;
  let wB = 0;
  let maxVariance = 0;
  let threshold = 160;

  for (let i = 0; i < 256; i++) {
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

/**
 * 3x3 中值滤波去噪
 * 对灰度图有效，消除孤立噪点（扫描件常见的椒盐噪声）
 */
function applyMedianFilter(imageData: ImageData): void {
  const { width, height, data } = imageData;
  const copy = new Uint8ClampedArray(data);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const neighbors = getNeighborValues(copy, width, x, y);
      neighbors.sort((a, b) => a - b);
      const median = neighbors[4]; // 9 个值的中位数
      const idx = (y * width + x) * 4;
      data[idx] = data[idx + 1] = data[idx + 2] = median;
    }
  }
}

/** 获取 3x3 邻域的灰度值（共 9 个） */
function getNeighborValues(
  data: Uint8ClampedArray, width: number, x: number, y: number,
): number[] {
  const values: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const idx = ((y + dy) * width + (x + dx)) * 4;
      values.push(data[idx]);
    }
  }
  return values;
}

function boxBlur(values: Float32Array, width: number, height: number, radius: number): Float32Array {
  const temp = new Float32Array(values.length);
  const output = new Float32Array(values.length);
  const diameter = radius * 2 + 1;

  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let dx = -radius; dx <= radius; dx++) {
      sum += values[y * width + clampIndex(dx, 0, width - 1)];
    }
    for (let x = 0; x < width; x++) {
      temp[y * width + x] = sum / diameter;
      const removeX = clampIndex(x - radius, 0, width - 1);
      const addX = clampIndex(x + radius + 1, 0, width - 1);
      sum += values[y * width + addX] - values[y * width + removeX];
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      sum += temp[clampIndex(dy, 0, height - 1) * width + x];
    }
    for (let y = 0; y < height; y++) {
      output[y * width + x] = sum / diameter;
      const removeY = clampIndex(y - radius, 0, height - 1);
      const addY = clampIndex(y + radius + 1, 0, height - 1);
      sum += temp[addY * width + x] - temp[removeY * width + x];
    }
  }

  return output;
}

function clamp(val: number): number {
  return Math.max(0, Math.min(255, Math.round(val)));
}

function clampIndex(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}
