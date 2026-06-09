import type { ImageProcessingDiagnostic } from '../types/ocr-diagnostics';
import { debugLog } from '../utils/debug-log';
import { evaluateCaptureCanvas } from './capture-quality';
import { scanDocumentCanvas } from './document-scan';
import { attachImageProcessingDiagnostic } from './image-processing-diagnostics';
import { preprocessCanvas } from './image-preprocess';

const SOURCE_ANALYSIS_LONG_SIDE = 3200;
const OCR_OUTPUT_LONG_SIDE = 2400;
const OCR_JPEG_QUALITY = 0.92;

export async function standardizeImageForOcr(file: File, pageNumber: number): Promise<File> {
  const sourceCanvas = await fileToCanvas(file, SOURCE_ANALYSIS_LONG_SIDE);
  const scanResult = scanDocumentCanvas(sourceCanvas);
  const outputCanvas = scanResult.metrics.detected
    ? resizeCanvas(scanResult.outputCanvas, OCR_OUTPUT_LONG_SIDE)
    : buildFallbackOcrCanvas(sourceCanvas);
  const normalizedName = buildOcrPageFileName(pageNumber);
  const normalizedFile = await canvasToJpegFile(outputCanvas, normalizedName, OCR_JPEG_QUALITY);
  const outputQuality = evaluateCaptureCanvas(outputCanvas);
  const diagnostic: ImageProcessingDiagnostic = {
    fileName: normalizedFile.name,
    originalFileName: file.name,
    pageNumber,
    strategy: scanResult.metrics.detected ? 'scan-corrected' : 'fallback-enhanced',
    detected: scanResult.metrics.detected,
    scanLevel: scanResult.level,
    scanScore: scanResult.score,
    coverage: roundMetric(scanResult.metrics.coverage),
    aspectRatio: roundMetric(scanResult.metrics.aspectRatio),
    skew: roundMetric(scanResult.metrics.skew),
    originalWidth: sourceCanvas.width,
    originalHeight: sourceCanvas.height,
    outputWidth: outputCanvas.width,
    outputHeight: outputCanvas.height,
    originalBytes: file.size,
    outputBytes: normalizedFile.size,
    compressionRatio: file.size > 0 ? roundMetric(normalizedFile.size / file.size) : null,
    outputQualityScore: outputQuality.score,
    outputSharpness: outputQuality.sharpness,
    outputBrightness: outputQuality.brightness,
    issues: [...scanResult.issues, ...outputQuality.issues],
  };
  debugLog('[ImagePipeline]', JSON.stringify(diagnostic));
  return attachImageProcessingDiagnostic(normalizedFile, diagnostic);
}

function buildFallbackOcrCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const resized = resizeCanvas(source, OCR_OUTPUT_LONG_SIDE);
  return preprocessCanvas(resized, {
    contrast: 1.22,
    binarize: false,
    denoise: false,
    shadowCorrection: true,
    sharpen: 0.14,
  });
}

async function fileToCanvas(file: File, maxLongSide: number): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  try {
    const sourceLongSide = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, maxLongSide / sourceLongSide);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Unable to read image for OCR');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    bitmap.close();
  }
}

function resizeCanvas(source: HTMLCanvasElement, maxLongSide: number): HTMLCanvasElement {
  const sourceLongSide = Math.max(source.width, source.height);
  const scale = Math.min(1, maxLongSide / sourceLongSide);
  if (scale >= 1) return source;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to resize OCR image');
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function canvasToJpegFile(canvas: HTMLCanvasElement, fileName: string, quality: number): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Unable to save OCR image'));
        return;
      }
      resolve(new File([blob], fileName, {
        type: 'image/jpeg',
        lastModified: Date.now(),
      }));
    }, 'image/jpeg', quality);
  });
}

function buildOcrPageFileName(pageNumber: number): string {
  return `credit-report-page-${String(pageNumber).padStart(2, '0')}.jpg`;
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}
