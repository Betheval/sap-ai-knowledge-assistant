export interface RetrievedChunk {
  id: string
  /** Page title and heading breadcrumb, e.g. "Custom Actions and Functions › Implementing Actions". */
  title: string
  /** Public URL of the source section. */
  url: string
  content: string
  score: number
}

/** CAP runtime the documentation is filtered for: CAP has a Node.js and a Java implementation. */
export type Runtime = 'node' | 'java'

export interface SearchOptions {
  /** Leave out documentation that only applies to the other runtime. */
  runtime?: Runtime
}

/**
 * Document retrieval port (ADR 0003). Implementations return chunks ranked by
 * relevance and drop chunks below their own relevance threshold, because score
 * scales differ between retrieval strategies (ADR 0008, ADR 0010).
 */
export interface Retriever {
  search(query: string, k: number, options?: SearchOptions): Promise<RetrievedChunk[]>
}
