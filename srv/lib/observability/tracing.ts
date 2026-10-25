import { SpanStatusCode, trace, type Attributes, type Span } from '@opentelemetry/api'

/**
 * OpenTelemetry spans for the assistant's own steps (ADR 0017). @cap-js/telemetry
 * registers the SDK and traces HTTP, CAP services and queries; without it (tests,
 * normal development) the API is a no-op and this costs nothing.
 */
const tracer = trace.getTracer('sap-ai-knowledge-assistant')

export async function traced<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes: Attributes = {},
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn(span)
    } catch (error) {
      span.recordException(error as Error)
      span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message })
      throw error
    } finally {
      span.end()
    }
  })
}
