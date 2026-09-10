import fs from "node:fs";
import path from "node:path";
import { sanitizeForFilesystem } from "../canonicalize/sanitize.js";
import type { CmrExtractionResult } from "../extraction/types.js";

function pickDate(extraction: CmrExtractionResult, receivedAt: Date): string {
  const raw = extraction.field4_pickup_date?.trim();
  if (raw && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw.slice(0, 10);
  }
  // Val terug op de ontvangstdatum van het WhatsApp-bericht als vak 4 niet
  // (goed) leesbaar/parseerbaar was.
  return receivedAt.toISOString().slice(0, 10);
}

function buildBaseFilename(extraction: CmrExtractionResult, receivedAt: Date): string {
  const date = pickDate(extraction, receivedAt);
  const order = extraction.field13_order_number?.trim();
  const ref = extraction.field13_reference_number?.trim();

  const parts = [date];
  parts.push(order ? sanitizeForFilesystem(order) : "GEEN-ORDERNR");
  if (ref) {
    // Referentienummers kunnen erg lang zijn (zie voorbeeld:
    // "[300_CMR_131165_Jacobs / Cooperatie Hoogstraten_09/09/2026 00:00:00]") —
    // inkorten zodat de bestandsnaam behapbaar blijft.
    const shortRef = sanitizeForFilesystem(ref).slice(0, 40);
    parts.push(shortRef);
  }
  return parts.join("_");
}

export interface BuiltPath {
  senderFolder: string;
  receiverFolder: string;
  filename: string;
  /** Relatief pad t.o.v. NAS_ROOT, met voorwaartse slashes. */
  relativePath: string;
}

/**
 * Bouwt het doelpad {sender}/{receiver}/{datum}_{order}_{ref}.ext, en zoekt
 * (op basis van wat al op disk staat) een niet-botsende bestandsnaam
 * (_2, _3, ...) zodat een tweede bon met hetzelfde ordernummer op dezelfde
 * dag niet de eerste overschrijft.
 */
export function buildDestinationPath(
  nasRoot: string,
  canonicalSender: string,
  canonicalReceiver: string,
  extraction: CmrExtractionResult,
  receivedAt: Date,
  extension: string
): BuiltPath {
  const senderFolder = sanitizeForFilesystem(canonicalSender);
  const receiverFolder = sanitizeForFilesystem(canonicalReceiver);
  const base = buildBaseFilename(extraction, receivedAt);
  const ext = extension.startsWith(".") ? extension : `.${extension}`;

  const dir = path.join(nasRoot, senderFolder, receiverFolder);

  let candidate = `${base}${ext}`;
  let attempt = 1;
  while (fs.existsSync(path.join(dir, candidate))) {
    attempt += 1;
    candidate = `${base}_${attempt}${ext}`;
  }

  return {
    senderFolder,
    receiverFolder,
    filename: candidate,
    relativePath: `${senderFolder}/${receiverFolder}/${candidate}`,
  };
}

export function buildReviewPath(
  nasRoot: string,
  reviewFolderName: string,
  whatsappMessageId: string,
  receivedAt: Date,
  extension: string
): BuiltPath {
  const ext = extension.startsWith(".") ? extension : `.${extension}`;
  const stamp = receivedAt.toISOString().replace(/[:.]/g, "-");
  const shortId = sanitizeForFilesystem(whatsappMessageId).slice(0, 24);
  const filename = `${stamp}_${shortId}${ext}`;
  return {
    senderFolder: reviewFolderName,
    receiverFolder: "",
    filename,
    relativePath: `${reviewFolderName}/${filename}`,
  };
}
