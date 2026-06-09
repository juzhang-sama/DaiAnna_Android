import type { ImageProcessingDiagnostic } from '../types/ocr-diagnostics';

const diagnosticsByFile = new WeakMap<File, ImageProcessingDiagnostic>();

export function attachImageProcessingDiagnostic(
  file: File,
  diagnostic: ImageProcessingDiagnostic,
): File {
  diagnosticsByFile.set(file, diagnostic);
  return file;
}

export function getImageProcessingDiagnostics(files: File[]): ImageProcessingDiagnostic[] {
  return files
    .map((file) => diagnosticsByFile.get(file))
    .filter((item): item is ImageProcessingDiagnostic => Boolean(item));
}
