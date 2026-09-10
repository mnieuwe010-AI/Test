import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { SCHEMA_SQL } from "./schema.js";

export type MessageStatus =
  | "received"
  | "extracted"
  | "filed"
  | "needs_review"
  | "skipped_not_cmr"
  | "error"
  | "pending_nas";

export interface ProcessedMessageRow {
  id: number;
  whatsapp_message_id: string;
  whatsapp_timestamp: number | null;
  received_at: string;
  status: MessageStatus;
  extraction_json: string | null;
  is_cmr_document: 0 | 1 | null;
  document_confidence: "high" | "medium" | "low" | null;
  canonical_sender: string | null;
  canonical_receiver: string | null;
  decided_file_path: string | null;
  error_message: string | null;
  review_reason: string | null;
  updated_at: string;
}

export type CompanyRole = "sender" | "receiver" | "both";

export interface CompanyAliasRow {
  id: number;
  raw_variant: string;
  canonical_name: string;
  role: CompanyRole;
  confirmed: 0 | 1;
  created_at: string;
  updated_at: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Genormaliseerde sleutel voor alias-matching: lowercase, spaties samengevoegd, getrimd. */
export function normalizeForMatching(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s+/g, " ");
}

export class Repository {
  private db: Database.Database;

  constructor(databasePath: string = config.databasePath) {
    if (databasePath !== ":memory:") {
      fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    }
    this.db = new Database(databasePath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA_SQL);
  }

  close(): void {
    this.db.close();
  }

  // ---- processed_messages -------------------------------------------------

  /**
   * Registreert een binnengekomen bericht. Retourneert false als het bericht-ID
   * al bekend is (dedupe/idempotentie) — de caller moet dan meteen stoppen met
   * verwerken, niet opnieuw downloaden/extraheren/filen.
   */
  insertReceived(whatsappMessageId: string, whatsappTimestamp: number | null): boolean {
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO processed_messages
         (whatsapp_message_id, whatsapp_timestamp, received_at, status, updated_at)
       VALUES (?, ?, ?, 'received', ?)`
    );
    const result = stmt.run(
      whatsappMessageId,
      whatsappTimestamp,
      nowIso(),
      nowIso()
    );
    return result.changes > 0;
  }

  getByMessageId(whatsappMessageId: string): ProcessedMessageRow | undefined {
    return this.db
      .prepare(`SELECT * FROM processed_messages WHERE whatsapp_message_id = ?`)
      .get(whatsappMessageId) as ProcessedMessageRow | undefined;
  }

  updateExtraction(
    whatsappMessageId: string,
    extractionJson: string,
    isCmrDocument: boolean,
    documentConfidence: "high" | "medium" | "low"
  ): void {
    this.db
      .prepare(
        `UPDATE processed_messages
           SET status = 'extracted', extraction_json = ?, is_cmr_document = ?,
               document_confidence = ?, updated_at = ?
         WHERE whatsapp_message_id = ?`
      )
      .run(
        extractionJson,
        isCmrDocument ? 1 : 0,
        documentConfidence,
        nowIso(),
        whatsappMessageId
      );
  }

  markSkippedNotCmr(whatsappMessageId: string): void {
    this.setStatus(whatsappMessageId, "skipped_not_cmr");
  }

  /**
   * Terminale status na een GESLAAGDE schrijfactie naar de sender/receiver-map.
   */
  markFiled(
    whatsappMessageId: string,
    canonicalSender: string,
    canonicalReceiver: string,
    filePath: string
  ): void {
    this.db
      .prepare(
        `UPDATE processed_messages
           SET status = 'filed', canonical_sender = ?, canonical_receiver = ?,
               decided_file_path = ?, updated_at = ?
         WHERE whatsapp_message_id = ?`
      )
      .run(canonicalSender, canonicalReceiver, filePath, nowIso(), whatsappMessageId);
  }

  /**
   * Terminale status na een GESLAAGDE schrijfactie naar de _TE_CONTROLEREN-map.
   * (Alleen aanroepen nadat het bestand daadwerkelijk op de NAS staat —
   * anders markPendingNas() gebruiken met reviewReason, zie hieronder.)
   */
  markFiledToReview(
    whatsappMessageId: string,
    canonicalSender: string,
    canonicalReceiver: string,
    filePath: string,
    reason: string
  ): void {
    this.db
      .prepare(
        `UPDATE processed_messages
           SET status = 'needs_review', canonical_sender = ?, canonical_receiver = ?,
               decided_file_path = ?, review_reason = ?, updated_at = ?
         WHERE whatsapp_message_id = ?`
      )
      .run(canonicalSender, canonicalReceiver, filePath, reason, nowIso(), whatsappMessageId);
  }

  /**
   * De NAS was onbereikbaar; bytes staan lokaal gespoold. Status blijft
   * bewust 'pending_nas' (NIET meteen 'filed'/'needs_review') totdat
   * flushPendingSpool() de daadwerkelijke NAS-schrijfactie bevestigt — anders
   * zou getPendingNas() deze rij nooit meer oppikken en blijft hij voor
   * altijd alleen lokaal gespoold staan. reviewReason (indien gezet) bepaalt
   * na een geslaagde flush of dit als 'filed' of 'needs_review' eindigt.
   */
  markPendingNas(
    whatsappMessageId: string,
    canonicalSender: string,
    canonicalReceiver: string,
    intendedFilePath: string,
    reviewReason: string | null = null
  ): void {
    this.db
      .prepare(
        `UPDATE processed_messages
           SET status = 'pending_nas', canonical_sender = ?, canonical_receiver = ?,
               decided_file_path = ?, review_reason = ?, updated_at = ?
         WHERE whatsapp_message_id = ?`
      )
      .run(
        canonicalSender,
        canonicalReceiver,
        intendedFilePath,
        reviewReason,
        nowIso(),
        whatsappMessageId
      );
  }

  markError(whatsappMessageId: string, errorMessage: string): void {
    this.db
      .prepare(
        `UPDATE processed_messages
           SET status = 'error', error_message = ?, updated_at = ?
         WHERE whatsapp_message_id = ?`
      )
      .run(errorMessage, nowIso(), whatsappMessageId);
  }

  private setStatus(whatsappMessageId: string, status: MessageStatus): void {
    this.db
      .prepare(
        `UPDATE processed_messages SET status = ?, updated_at = ? WHERE whatsapp_message_id = ?`
      )
      .run(status, nowIso(), whatsappMessageId);
  }

  /** Rijen die door een crash halverwege zijn blijven steken — te hervatten bij opstarten. */
  getUnfinished(): ProcessedMessageRow[] {
    return this.db
      .prepare(
        `SELECT * FROM processed_messages
         WHERE status IN ('received', 'extracted', 'pending_nas')
         ORDER BY id ASC`
      )
      .all() as ProcessedMessageRow[];
  }

  getPendingNas(): ProcessedMessageRow[] {
    return this.db
      .prepare(`SELECT * FROM processed_messages WHERE status = 'pending_nas' ORDER BY id ASC`)
      .all() as ProcessedMessageRow[];
  }

  // ---- company_aliases ------------------------------------------------------

  findAlias(rawVariant: string): CompanyAliasRow | undefined {
    const key = normalizeForMatching(rawVariant);
    return this.db
      .prepare(`SELECT * FROM company_aliases WHERE raw_variant = ?`)
      .get(key) as CompanyAliasRow | undefined;
  }

  listAllAliases(): CompanyAliasRow[] {
    return this.db.prepare(`SELECT * FROM company_aliases`).all() as CompanyAliasRow[];
  }

  /** Upsert op raw_variant: bestaat de variant al, dan wordt 'm bijgewerkt i.p.v. gedupliceerd. */
  insertAlias(
    rawVariant: string,
    canonicalName: string,
    role: CompanyRole,
    confirmed: boolean
  ): void {
    const key = normalizeForMatching(rawVariant);
    this.db
      .prepare(
        `INSERT INTO company_aliases (raw_variant, canonical_name, role, confirmed, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(raw_variant) DO UPDATE SET
           canonical_name = excluded.canonical_name,
           role = excluded.role,
           updated_at = excluded.updated_at`
      )
      .run(key, canonicalName, role, confirmed ? 1 : 0, nowIso(), nowIso());
  }
}
