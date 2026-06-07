import type { InstitutionCorrectionDiagnostic } from '../types/ocr-diagnostics';

export function buildInstitutionReviewIssueId(
  item: InstitutionCorrectionDiagnostic,
  index: number,
): string {
  return [
    'institution',
    index,
    item.field,
    item.original,
    item.normalized,
    item.status,
  ].map((part) => encodeURIComponent(String(part ?? ''))).join(':');
}

export function isInstitutionReviewable(item: InstitutionCorrectionDiagnostic): boolean {
  return item.status !== 'matched';
}
