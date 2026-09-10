import { downloadMediaMessage, type WASocket, type proto } from "@whiskeysockets/baileys";
import { config } from "../config.js";
import type { Repository } from "../db/repository.js";
import { processCmrImage } from "../pipeline.js";
import { baileysLogger } from "./client.js";

/**
 * Verwerkt een batch binnenkomende berichten: filtert op de geconfigureerde
 * groep en op afbeeldingsberichten, dedupliceert via de database, downloadt
 * de foto en geeft 'm door aan de verwerkingspijplijn.
 */
export async function handleMessages(
  repo: Repository,
  sock: WASocket,
  messages: proto.IWebMessageInfo[]
): Promise<void> {
  for (const msg of messages) {
    await handleOneMessage(repo, sock, msg);
  }
}

async function handleOneMessage(
  repo: Repository,
  sock: WASocket,
  msg: proto.IWebMessageInfo
): Promise<void> {
  const remoteJid = msg.key.remoteJid ?? "";
  const messageId = msg.key.id ?? "";
  if (!messageId || !remoteJid) return;

  if (config.whatsappLogAllGroups && remoteJid.endsWith("@g.us")) {
    console.log(`[whatsapp] groepsbericht gezien, JID: ${remoteJid}`);
  }

  const targetJid = config.whatsappGroupJid;
  if (!targetJid || remoteJid !== targetJid) return;

  const imageMessage = msg.message?.imageMessage;
  if (!imageMessage) return; // alleen foto's verwerken; tekst/overig negeren

  const rawTimestamp =
    typeof msg.messageTimestamp === "number"
      ? msg.messageTimestamp
      : Number(msg.messageTimestamp ?? 0);

  // Dedupe/idempotentie: als dit bericht-ID al bekend is (bv. WhatsApp
  // leverde het opnieuw af na een herverbinding), meteen stoppen.
  const isNew = repo.insertReceived(messageId, rawTimestamp || null);
  if (!isNew) return;

  try {
    const buffer = (await downloadMediaMessage(
      msg,
      "buffer",
      {},
      { logger: baileysLogger, reuploadRequest: sock.updateMediaMessage }
    )) as Buffer;

    const receivedAt = rawTimestamp ? new Date(rawTimestamp * 1000) : new Date();
    await processCmrImage(repo, messageId, buffer, receivedAt);
  } catch (err) {
    repo.markError(messageId, `Download/verwerking mislukt: ${(err as Error).message}`);
    console.error(`[whatsapp] Verwerken van bericht ${messageId} mislukt:`, err);
  }
}
