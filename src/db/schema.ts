// Schema als TS-string (i.p.v. een los .sql-bestand): tsc kopieert geen
// niet-.ts-bestanden naar dist/, dus een los schema.sql zou daar simpelweg
// ontbreken na een build en de database-laag stuk maken bij het eerste
// gebruik op de VPS. Dit bestand is de enige bron van waarheid voor het schema.
export const SCHEMA_SQL = `
-- processed_messages: idempotentieslot (UNIQUE op whatsapp_message_id) + auditspoor
-- per binnengekomen bon-foto.
CREATE TABLE IF NOT EXISTS processed_messages (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  whatsapp_message_id TEXT    UNIQUE NOT NULL,
  whatsapp_timestamp  INTEGER,
  received_at         TEXT    NOT NULL,

  -- received | extracted | filed | needs_review | skipped_not_cmr | error | pending_nas
  status              TEXT    NOT NULL DEFAULT 'received',

  extraction_json      TEXT,
  is_cmr_document       INTEGER, -- 0/1
  document_confidence   TEXT,    -- high | medium | low

  canonical_sender     TEXT,
  canonical_receiver   TEXT,
  decided_file_path    TEXT,

  error_message   TEXT,
  review_reason   TEXT,

  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_processed_messages_status
  ON processed_messages (status);

-- company_aliases: canonicaliseert leverancier-/klantnamen zoals ze door de
-- vision-extractie worden teruggegeven, zodat "Wilko Fruit B.V." en
-- "WILKO FRUIT BV" niet als twee verschillende mappen eindigen.
CREATE TABLE IF NOT EXISTS company_aliases (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_variant      TEXT    UNIQUE NOT NULL, -- genormaliseerd (lowercase/trim) voor matching
  canonical_name   TEXT    NOT NULL,        -- daadwerkelijke mapnaam (al gesanitized)
  role             TEXT    NOT NULL,        -- sender | receiver | both
  confirmed        INTEGER NOT NULL DEFAULT 0, -- 0/1, door mens bevestigd?
  created_at       TEXT    NOT NULL,
  updated_at       TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_company_aliases_canonical
  ON company_aliases (canonical_name);
`;
