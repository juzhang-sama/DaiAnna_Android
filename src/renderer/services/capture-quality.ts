export type CaptureQualityLevel = 'pass' | 'warn' | 'reject';

export interface CaptureQualityResult {
  level: CaptureQualityLevel;
  score: number;
  width: number;
  height: number;
  megapixels: number;
  sharpness: number;
  brightness: number;
  overexposedRatio: number;
  underexposedRatio: number;
  issues: string[];
}

const MIN_SHORT_SIDE_REJECT = 1200;
const MIN_SHORT_SIDE_WARN = 1600;
const MIN_MEGAPIXELS_REJECT = 1.5;
const MIN_MEGAPIXELS_WARN = 2.4;
const SHARPNESS_REJECT = 55;
const SHARPNESS_WARN = 95;
const BRIGHTNESS_LOW_REJECT = 55;
const BRIGHTNESS_HIGH_REJECT = 248;
const BRIGHTNESS_LOW_WARN = 70;
const BRIGHTNESS_HIGH_WARN = 235;
const OVEREXPOSED_REJECT = 0.45;
const OVEREXPOSED_WARN = 0.3;
const UNDEREXPOSED_REJECT = 0.18;
const UNDEREXPOSED_WARN = 0.12;
const SAMPLE_SIZE = 900;

export async function evaluateCaptureQuality(file: File): Promise<CaptureQualityResult> {
  const image = await loadImage(file);
  return evaluateCaptureImage(image);
}

export function evaluateCaptureCanvas(canvas: HTMLCanvasElement): CaptureQualityResult {
  return evaluateCaptureSource(canvas.width, canvas.height, (ctx) => {
    ctx.drawImage(canvas, 0, 0);
  });
}

function evaluateCaptureImage(image: HTMLImageElement): CaptureQualityResult {
  return evaluateCaptureSource(image.naturalWidth || image.width, image.naturalHeight || image.height, (ctx, width, height) => {
    ctx.drawImage(image, 0, 0, width, height);
  });
}

function evaluateCaptureSource(
  sourceWidth: number,
  sourceHeight: number,
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
): CaptureQualityResult {
  const width = sourceWidth;
  const height = sourceHeight;
  const shortSide = Math.min(width, height);
  const megapixels = (width * height) / 1_000_000;
  const scale = Math.min(1, SAMPLE_SIZE / Math.max(width, height));
  const sampleWidth = Math.max(1, Math.round(width * scale));
  const sampleHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx || sampleWidth < 3 || sampleHeight < 3) {
    return buildResult(width, height, megapixels, 0, 0, 1, 1, ['图像无法评估，请重拍']);
  }

  ctx.save();
  ctx.scale(scale, scale);
  draw(ctx, width, height);
  ctx.restore();

  const { data } = ctx.getImageData(0, 0, sampleWidth, sampleHeight);
  const gray = new Float32Array(sampleWidth * sampleHeight);
  let brightnessSum = 0;
  let overexposed = 0;
  let underexposed = 0;

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const value = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    gray[p] = value;
    brightnessSum += value;
    if (value >= 245) overexposed++;
    if (value <= 28) underexposed++;
  }

  const total = gray.length;
  const brightness = brightnessSum / total;
  const sharpness = measureSharpness(gray, sampleWidth, sampleHeight);
  const overexposedRatio = overexposed / total;
  const underexposedRatio = underexposed / total;
  const issues: string[] = [];

  if (shortSide < MIN_SHORT_SIDE_REJECT) {
    issues.push('页面分辨率过低');
  } else if (shortSide < MIN_SHORT_SIDE_WARN) {
    issues.push('页面分辨率一般');
  }

  if (megapixels < MIN_MEGAPIXELS_REJECT) {
    issues.push('页面像素过低');
  } else if (megapixels < MIN_MEGAPIXELS_WARN) {
    issues.push('页面像素略低');
  }

  if (sharpness < SHARPNESS_REJECT) {
    issues.push('画面不清晰');
  } else if (sharpness < SHARPNESS_WARN) {
    issues.push('画面清晰度一般');
  }

  if (brightness < BRIGHTNESS_LOW_REJECT) {
    issues.push('画面过暗');
  } else if (brightness < BRIGHTNESS_LOW_WARN) {
    issues.push('画面偏暗');
  }

  if (brightness > BRIGHTNESS_HIGH_REJECT) {
    issues.push('画面过亮');
  } else if (brightness > BRIGHTNESS_HIGH_WARN) {
    issues.push('画面偏亮');
  }

  if (overexposedRatio > OVEREXPOSED_REJECT) {
    issues.push('反光或过曝面积过大');
  } else if (overexposedRatio > OVEREXPOSED_WARN) {
    issues.push('存在明显反光');
  }

  if (underexposedRatio > UNDEREXPOSED_REJECT) {
    issues.push('暗部遮挡过多');
  } else if (underexposedRatio > UNDEREXPOSED_WARN) {
    issues.push('暗部偏多');
  }

  return buildResult(width, height, megapixels, sharpness, brightness, overexposedRatio, underexposedRatio, issues);
}

function buildResult(
  width: number,
  height: number,
  megapixels: number,
  sharpness: number,
  brightness: number,
  overexposedRatio: number,
  underexposedRatio: number,
  issues: string[],
): CaptureQualityResult {
  let score = 100;
  const shortSide = Math.min(width, height);
  if (shortSide < MIN_SHORT_SIDE_REJECT) score -= 32;
  else if (shortSide < MIN_SHORT_SIDE_WARN) score -= 14;
  if (megapixels < MIN_MEGAPIXELS_REJECT) score -= 24;
  else if (megapixels < MIN_MEGAPIXELS_WARN) score -= 10;
  if (sharpness < SHARPNESS_REJECT) score -= 34;
  else if (sharpness < SHARPNESS_WARN) score -= 14;
  if (brightness < BRIGHTNESS_LOW_REJECT || brightness > BRIGHTNESS_HIGH_REJECT) score -= 24;
  else if (brightness < BRIGHTNESS_LOW_WARN || brightness > BRIGHTNESS_HIGH_WARN) score -= 10;
  if (overexposedRatio > OVEREXPOSED_REJECT) score -= 24;
  else if (overexposedRatio > OVEREXPOSED_WARN) score -= 10;
  if (underexposedRatio > UNDEREXPOSED_REJECT) score -= 18;
  else if (underexposedRatio > UNDEREXPOSED_WARN) score -= 8;

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  const level: CaptureQualityLevel = finalScore < 70 || hasRejectSignal(width, height, megapixels, sharpness, brightness, overexposedRatio, underexposedRatio)
    ? 'reject'
    : finalScore < 85 || issues.length > 0
      ? 'warn'
      : 'pass';

  return {
    level,
    score: finalScore,
    width,
    height,
    megapixels: round(megapixels),
    sharpness: Math.round(sharpness),
    brightness: Math.round(brightness),
    overexposedRatio: round(overexposedRatio),
    underexposedRatio: round(underexposedRatio),
    issues,
  };
}

function hasRejectSignal(
  width: number,
  height: number,
  megapixels: number,
  sharpness: number,
  brightness: number,
  overexposedRatio: number,
  underexposedRatio: number,
): boolean {
  return Math.min(width, height) < MIN_SHORT_SIDE_REJECT ||
    megapixels < MIN_MEGAPIXELS_REJECT ||
    sharpness < SHARPNESS_REJECT ||
    brightness < BRIGHTNESS_LOW_REJECT ||
    brightness > BRIGHTNESS_HIGH_REJECT ||
    overexposedRatio > OVEREXPOSED_REJECT ||
    underexposedRatio > UNDEREXPOSED_REJECT;
}

function measureSharpness(gray: Float32Array, width: number, height: number): number {
  const values: number[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      values.push(
        gray[idx - width] +
        gray[idx - 1] +
        gray[idx + 1] +
        gray[idx + width] -
        4 * gray[idx],
      );
    }
  }

  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    image.src = url;
  });
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
