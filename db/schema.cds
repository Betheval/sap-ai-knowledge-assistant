namespace knowledge;

using {
  cuid,
  managed
} from '@sap/cds/common';

entity Conversations : cuid, managed {
  title    : String(200);
  messages : Composition of many Messages
               on messages.conversation = $self;
}

type Role : String(10) enum {
  user;
  assistant;
}

entity Messages : cuid, managed {
  conversation   : Association to Conversations not null;
  // Order within the conversation. Messages written in the same request share
  // the same createdAt timestamp, so it cannot be used for ordering.
  sequence       : Integer not null;
  role           : Role not null;
  content        : LargeString not null;
  // Assistant messages only: retrieval query, model and timing (ADR 0006, 0007)
  rewrittenQuery : String(1000);
  model          : String(100);
  latencyMs      : Integer;
  sources        : Composition of many MessageSources
                     on sources.message = $self;
}

entity MessageSources : cuid {
  message : Association to Messages not null;
  // Position in the prompt context, i.e. the number used in citation markers [n]
  rank    : Integer not null;
  title   : String(300);
  url     : String(1000);
  snippet : LargeString;
  score   : Double;
  cited   : Boolean default false;
}

// ---------------------------------------------------------------------------
// Knowledge base: Capire pages split into chunks (ADR 0009). Internal, not
// exposed by any service. The embedding (ADR 0005) and full-text columns and
// their indexes are added in SQL on PostgreSQL (ADR 0011): @cap-js/postgres
// cannot write cds.Vector columns through CQL.
// ---------------------------------------------------------------------------

entity Documents : cuid, managed {
  // Path inside the cap-js/docs repository, e.g. guides/services/custom-actions.md
  path         : String(500) not null;
  title        : String(300);
  url          : String(1000);
  // Commit of cap-js/docs the document was ingested from
  sourceCommit : String(40);
  // Hash of the source file, to skip unchanged documents when re-ingesting
  contentHash  : String(64);
  chunks       : Composition of many Chunks
                   on chunks.document = $self;
}

annotate Documents with @assert.unique: {path: [path]};

entity Chunks : cuid {
  document       : Association to Documents not null;
  // Order of the chunk within its document
  position       : Integer not null;
  // Heading path, e.g. "Custom Actions and Functions › Implementing Actions"
  breadcrumb     : String(1000);
  // Public URL of the section, including the heading anchor
  url            : String(1000);
  content        : LargeString not null;
  tokenCount     : Integer;
  // Model that produced the embedding stored in the SQL-managed `embedding` column
  embeddingModel : String(100);
}
