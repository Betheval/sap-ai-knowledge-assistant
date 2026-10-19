/** Base class for provider errors that map to an HTTP status (ADR 0004). */
export abstract class ProviderError extends Error {
  abstract readonly status: number

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
  }
}

/** The LLM host cannot be reached or rejected the request. */
export class LLMUnavailableError extends ProviderError {
  readonly status = 503
}

/** The LLM did not answer within the configured timeout. */
export class LLMTimeoutError extends ProviderError {
  readonly status = 504
}
