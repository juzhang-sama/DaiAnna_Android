export type DiagnosticSeverity = 'critical' | 'warning' | 'info';

export interface ImageQualityDiagnostic {
  fileName: string;
  width: number;
  height: number;
  megapixels: number;
  sharpness: number;
  score: number;
  issues: string[];
}

export interface OcrCandidateDiagnostic {
  fileName: string;
  variant: string;
  selected: boolean;
  score: number;
  tables: number;
  anchorsFound: number;
  issues: string[];
}

export type ImageProcessingStrategy = 'scan-corrected' | 'fallback-enhanced';

export interface ImageProcessingDiagnostic {
  fileName: string;
  originalFileName: string;
  pageNumber: number;
  strategy: ImageProcessingStrategy;
  detected: boolean;
  scanLevel: 'pass' | 'warn' | 'reject';
  scanScore: number;
  coverage: number;
  aspectRatio: number;
  skew: number;
  originalWidth: number;
  originalHeight: number;
  outputWidth: number;
  outputHeight: number;
  originalBytes?: number;
  outputBytes?: number;
  compressionRatio?: number | null;
  outputQualityScore: number;
  outputSharpness: number;
  outputBrightness: number;
  issues: string[];
}

export interface CreditReportValidationIssue {
  id: string;
  severity: DiagnosticSeverity;
  category: string;
  field: string;
  label: string;
  message: string;
  suggestion: string;
}

export interface CreditReportValidationReport {
  score: number;
  requiresReview: boolean;
  summary: {
    critical: number;
    warning: number;
    info: number;
  };
  issues: CreditReportValidationIssue[];
}

export interface InstitutionCorrectionDiagnostic {
  field: string;
  original: string;
  normalized: string;
  sourceLabel?: string;
  pageNum?: number;
  logicalPage?: number;
  precedingText?: string;
  confidence: number;
  matched: boolean;
  applied: boolean;
  status: 'matched' | 'review' | 'unlisted';
  statusLabel: string;
  matchType: 'exact' | 'alias' | 'contains' | 'fuzzy' | 'none';
  candidates: string[];
}

export interface OcrReviewState {
  reviewedIssueIds: string[];
  reviewedAt?: string;
}

export interface OcrDiagnosticsReport {
  images: ImageQualityDiagnostic[];
  processing?: ImageProcessingDiagnostic[];
  candidates: OcrCandidateDiagnostic[];
  institutionCorrections?: InstitutionCorrectionDiagnostic[];
  validation: CreditReportValidationReport;
}
