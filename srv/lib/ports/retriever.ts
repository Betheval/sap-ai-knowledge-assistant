export interface RetrievedChunk {
  id: string
  /** Page title and heading breadcrumb, e.g. "Custom Actions and Functions › Implementing Actions". */
  title: string
  /** Public URL of the source section. */
  url: string
  content: string
  score: number
}

/**
 * Document retrieval port (ADR 0003). Implementations return chunks ranked by
 * relevance and drop chunks below their own relevance threshold, because score
 * scales differ between retrieval strategies (ADR 0008, ADR 0010).
 */
export interface Retriever {
  search(query: string, k: number): Promise<RetrievedChunk[]>
}
