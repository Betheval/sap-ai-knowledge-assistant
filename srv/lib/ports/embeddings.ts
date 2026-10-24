/**
 * Embedding port (ADR 0003, ADR 0005). Vectors from different models are not
 * comparable, so every stored vector records the `modelId` that produced it.
 */
export interface EmbeddingProvider {
  readonly modelId: string
  readonly dimensions: number

  /** One vector per input text, in input order. */
  embed(texts: string[]): Promise<number[][]>
}
