import cds from '@sap/cds'
import { Chunks, Documents } from '#cds-models/knowledge'
import type { DocumentInput, KnowledgeStore, StoredDocument } from '../../ingestion/ingest'

/**
 * Writes ingested documents to PostgreSQL. Documents and chunks go through CQL;
 * embeddings through SQL, because @cap-js/postgres cannot write vector columns
 * (ADR 0011).
 */
export class PostgresKnowledgeStore implements KnowledgeStore {
  constructor(private readonly db: cds.DatabaseService) {}

  async documents(): Promise<Map<string, StoredDocument>> {
    const rows = await this.db.run(cds.ql.SELECT.from(Documents).columns('ID', 'path', 'contentHash'))
    return new Map(rows.map((d) => [d.path!, { ID: d.ID!, contentHash: d.contentHash ?? undefined }]))
  }

  async databaseBytes(): Promise<number> {
    const [row] = await this.db.run('SELECT pg_database_size(current_database()) AS bytes')
    return Number(row.bytes)
  }

  async replaceDocument(doc: DocumentInput, existingID?: string): Promise<void> {
    const { INSERT, DELETE, UPSERT } = cds.ql
    await this.db.tx(async (tx) => {
      const ID = existingID ?? cds.utils.uuid()
      if (existingID) await tx.run(DELETE.from(Chunks).where({ document_ID: existingID }))
      await tx.run(
        UPSERT.into(Documents).entries({
          ID,
          path: doc.path,
          title: doc.title,
          url: doc.url,
          sourceCommit: doc.sourceCommit,
          contentHash: doc.contentHash,
        }),
      )

      const rows = doc.chunks.map((c) => ({
        ID: cds.utils.uuid(),
        document_ID: ID,
        position: c.position,
        breadcrumb: c.breadcrumb,
        url: c.url,
        content: c.content,
        tokenCount: c.tokenCount,
        embeddingModel: doc.embeddingModel,
      }))
      if (rows.length === 0) return
      await tx.run(INSERT.into(Chunks).entries(rows))
      await tx.run(
        `UPDATE knowledge_Chunks AS c SET embedding = v.embedding::vector
           FROM unnest($1::text[], $2::text[]) AS v(id, embedding)
          WHERE c.ID = v.id`,
        // One parameter row whose two values are arrays: CAP treats an array of arrays as a batch of rows
        [[rows.map((r) => r.ID), doc.chunks.map((c) => `[${c.embedding.join(',')}]`)]],
      )

      // Guard against a silent partial write of the vectors
      const [{ missing }] = await tx.run(
        'SELECT count(*)::int AS missing FROM knowledge_Chunks WHERE document_ID = $1 AND embedding IS NULL',
        [ID],
      )
      if (missing > 0) throw new Error(`${missing} chunks of ${doc.path} were stored without embedding`)
    })
  }

  async deleteDocuments(IDs: string[]): Promise<void> {
    if (IDs.length === 0) return
    const { DELETE } = cds.ql
    await this.db.tx(async (tx) => {
      await tx.run(DELETE.from(Chunks).where({ document_ID: { in: IDs } }))
      await tx.run(DELETE.from(Documents).where({ ID: { in: IDs } }))
    })
  }
}
