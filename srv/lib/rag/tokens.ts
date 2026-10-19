/**
 * Rough token estimate (about 4 characters per token for English text and code).
 * Good enough for budgeting; we keep a safety margin instead of shipping a
 * model-specific tokenizer.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
