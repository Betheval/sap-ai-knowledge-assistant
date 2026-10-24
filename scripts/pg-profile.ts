// Imported first by scripts that work on the PostgreSQL knowledge base, so the
// `pg` profile is active before CAP reads its configuration.
process.env.CDS_ENV ??= 'development,pg'
