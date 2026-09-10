import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import type { Repository } from "../db/repository.js";

/**
 * Test of NAS_ROOT bereikbaar en beschrijfbaar is door een klein testbestand
 * te schrijven en meteen weer te verwijderen. Faalt hard/zichtbaar (logt) in
 * plaats van stil te falen — zie plan §4.
 */
export function checkNasHealthy(nasRoot: string = config.nasRoot): boolean {
  try {
    fs.mkdirSync(nasRoot, { recursive: true });
    const probe = path.join(nasRoot, ".healthcheck");
    fs.writeFileSync(probe, `ok ${new Date().toISOString()}`);
    fs.unlinkSync(probe);
    return true;
  } catch (err) {
    console.error(
      `[nasWriter] NAS_ROOT (${nasRoot}) is niet beschrijfbaar:`,
      (err as Error).message
    );
    return false;
  }
}

/**
 * Schrijft atomisch: eerst naar een tijdelijk bestand in dezelfde map, dan
 * hernoemen. Voorkomt half geschreven bestanden als het proces halverwege
 * crasht of de NAS-verbinding wegvalt.
 */
export function writeFileAtomic(absolutePath: string, data: Buffer): void {
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const tmpPath = `${absolutePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, data);
  fs.renameSync(tmpPath, absolutePath);
}

export function writeToNas(
  relativePath: string,
  data: Buffer,
  nasRoot: string = config.nasRoot
): string {
  const absolutePath = path.join(nasRoot, relativePath);
  writeFileAtomic(absolutePath, data);
  return absolutePath;
}

// ---- Pending spool (fallback als de NAS tijdelijk onbereikbaar is) --------

function spoolPaths(spoolDir: string, whatsappMessageId: string) {
  const safeId = whatsappMessageId.replace(/[/\\:*?"<>|]/g, "_");
  return {
    bin: path.join(spoolDir, `${safeId}.bin`),
    meta: path.join(spoolDir, `${safeId}.json`),
  };
}

export interface SpoolMeta {
  whatsappMessageId: string;
  relativePath: string;
  spooledAt: string;
}

export function spoolPending(
  whatsappMessageId: string,
  relativePath: string,
  data: Buffer,
  spoolDir: string = config.pendingSpoolDir
): void {
  fs.mkdirSync(spoolDir, { recursive: true });
  const { bin, meta } = spoolPaths(spoolDir, whatsappMessageId);
  writeFileAtomic(bin, data);
  const metadata: SpoolMeta = {
    whatsappMessageId,
    relativePath,
    spooledAt: new Date().toISOString(),
  };
  writeFileAtomic(meta, Buffer.from(JSON.stringify(metadata, null, 2)));
}

/**
 * Probeert alle gespoolde bestanden alsnog naar de NAS te schrijven. Bedoeld
 * om periodiek aangeroepen te worden (bv. elke paar minuten) zolang er
 * pending_nas-rijen in de database staan. Werkt de database bij en ruimt de
 * spoolbestanden op bij succes.
 */
export function flushPendingSpool(
  repo: Repository,
  nasRoot: string = config.nasRoot,
  spoolDir: string = config.pendingSpoolDir
): { flushed: number; stillPending: number } {
  if (!checkNasHealthy(nasRoot)) {
    const pending = repo.getPendingNas();
    return { flushed: 0, stillPending: pending.length };
  }

  const pending = repo.getPendingNas();
  let flushed = 0;

  for (const row of pending) {
    if (!row.decided_file_path) continue;
    const { bin, meta } = spoolPaths(spoolDir, row.whatsapp_message_id);
    if (!fs.existsSync(bin)) {
      // Niets gespoold gevonden voor deze rij — kan niet automatisch hersteld
      // worden; blijft in pending_nas staan voor handmatige inspectie.
      continue;
    }
    try {
      const data = fs.readFileSync(bin);
      writeToNas(row.decided_file_path, data, nasRoot);
      const absolutePath = path.join(nasRoot, row.decided_file_path);
      if (row.review_reason) {
        repo.markFiledToReview(
          row.whatsapp_message_id,
          row.canonical_sender ?? "",
          row.canonical_receiver ?? "",
          absolutePath,
          row.review_reason
        );
      } else {
        repo.markFiled(
          row.whatsapp_message_id,
          row.canonical_sender ?? "",
          row.canonical_receiver ?? "",
          absolutePath
        );
      }
      fs.rmSync(bin, { force: true });
      fs.rmSync(meta, { force: true });
      flushed += 1;
    } catch (err) {
      console.error(
        `[nasWriter] flush van ${row.whatsapp_message_id} mislukt:`,
        (err as Error).message
      );
    }
  }

  return { flushed, stillPending: pending.length - flushed };
}
