/**
 * Maps a failed `ask` call to an i18n message key (ADR 0015). The backend maps
 * provider failures to 503/504 (ADR 0004); 404 and 400 come from the service.
 * Pure TypeScript, unit-tested with Jest.
 */

export type ErrorKey = 'errorUnavailable' | 'errorTimeout' | 'errorNotFound' | 'errorInvalid' | 'errorUnknown'

export interface AskErrorInfo {
  key: ErrorKey
  /** Technical detail, only shown for unknown errors. */
  detail?: string
  /** Whether sending the same question again can succeed. */
  retryable: boolean
}

export function describeAskError(error: unknown): AskErrorInfo {
  const status = (error as { status?: number })?.status
  const detail = error instanceof Error ? error.message : String(error)

  switch (status) {
    case 503:
      return { key: 'errorUnavailable', retryable: true }
    case 504:
      return { key: 'errorTimeout', retryable: true }
    case 404:
      return { key: 'errorNotFound', retryable: false }
    case 400:
      return { key: 'errorInvalid', retryable: false }
    default:
      return { key: 'errorUnknown', detail, retryable: true }
  }
}
