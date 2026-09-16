import { validateFontFileMetadata, type FontFileMetadataRejectionCode } from '../core/font-file';
import {
  detectFontFormat,
  isProcessableFontFormat,
  type ProcessableFontFormat,
} from '../core/font-format';

export type FontUploadRejectionCode =
  | FontFileMetadataRejectionCode
  | 'font-collection'
  | 'unknown-font-signature'
  | 'header-read-failed';

export interface ValidatedFontUpload {
  readonly file: File;
  readonly format: ProcessableFontFormat;
}

export interface RejectedFontUpload {
  readonly file: File;
  readonly code: FontUploadRejectionCode;
}

export interface FontUploadValidationResult {
  readonly accepted: readonly ValidatedFontUpload[];
  readonly rejected: readonly RejectedFontUpload[];
}

type CandidateValidation =
  { readonly accepted: ValidatedFontUpload } | { readonly rejected: RejectedFontUpload };

function abortError(): DOMException {
  return new DOMException('字体文件验证已取消', 'AbortError');
}

function ensureActive(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

async function validateCandidate(file: File, signal: AbortSignal): Promise<CandidateValidation> {
  ensureActive(signal);
  const metadata = validateFontFileMetadata(file);
  if (!metadata.valid) {
    return { rejected: { file, code: metadata.code } };
  }

  let header: ArrayBuffer;
  try {
    header = await file.slice(0, 4).arrayBuffer();
  } catch {
    ensureActive(signal);
    return { rejected: { file, code: 'header-read-failed' } };
  }
  ensureActive(signal);

  const format = detectFontFormat(header);
  if (format === 'ttc') {
    return { rejected: { file, code: 'font-collection' } };
  }
  if (!isProcessableFontFormat(format)) {
    return { rejected: { file, code: 'unknown-font-signature' } };
  }
  return { accepted: { file, format } };
}

export async function validateFontUploads(
  files: readonly File[],
  signal: AbortSignal,
): Promise<FontUploadValidationResult> {
  ensureActive(signal);
  const candidates = await Promise.all(files.map((file) => validateCandidate(file, signal)));
  ensureActive(signal);

  const accepted: ValidatedFontUpload[] = [];
  const rejected: RejectedFontUpload[] = [];
  for (const candidate of candidates) {
    if ('accepted' in candidate) {
      accepted.push(candidate.accepted);
    } else {
      rejected.push(candidate.rejected);
    }
  }
  return { accepted, rejected };
}
