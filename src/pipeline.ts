import { resolveCompanyName } from "./canonicalize/aliasResolver.js";
import { config } from "./config.js";
import type { Repository } from "./db/repository.js";
import { detectImageMediaType, extractCmrFromImage } from "./extraction/claudeClient.js";
import { decideRouting } from "./extraction/types.js";
import { buildDestinationPath, buildReviewPath } from "./storage/pathBuilder.js";
import { checkNasHealthy, spoolPending, writeToNas } from "./storage/nasWriter.js";
import { notifyReviewNeeded, notifyFiled } from "./notify/whatsappReply.js";

function extensionForMediaType(mediaType: string): string {
  switch (mediaType) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return "jpg";
  }
}

/**
 * Verwerkt één binnengekomen foto door de volledige pijplijn: Claude-extractie
 * -> canonicalisatie -> wegschrijven (NAS of spool) -> audit-status bijwerken.
 * Verwacht dat de listener al een 'received'-rij heeft aangemaakt (dedupe is
 * daar al afgehandeld) — deze functie wordt dus alleen aangeroepen voor
 * nieuwe, nog niet eerder geziene berichten.
 */
export async function processCmrImage(
  repo: Repository,
  whatsappMessageId: string,
  imageBuffer: Buffer,
  receivedAt: Date
): Promise<void> {
  const mediaType = detectImageMediaType(imageBuffer);
  const extension = extensionForMediaType(mediaType);

  let extraction;
  try {
    extraction = await extractCmrFromImage(imageBuffer, mediaType);
  } catch (err) {
    repo.markError(whatsappMessageId, `Extractie mislukt: ${(err as Error).message}`);
    return;
  }

  repo.updateExtraction(
    whatsappMessageId,
    JSON.stringify(extraction),
    extraction.is_cmr_document,
    extraction.document_confidence
  );

  const routing = decideRouting(extraction);

  if (routing.action === "skip_not_cmr") {
    repo.markSkippedNotCmr(whatsappMessageId);
    return;
  }

  if (routing.action === "needs_review") {
    const built = buildReviewPath(
      config.nasRoot,
      config.reviewFolderName,
      whatsappMessageId,
      receivedAt,
      extension
    );
    writeOrSpoolForReview(repo, whatsappMessageId, built.relativePath, imageBuffer, routing.reason);
    await notifyReviewNeeded(routing.reason, built.relativePath);
    return;
  }

  // routing.action === "file"
  const sender = resolveCompanyName(repo, extraction.field1_sender_name!, "sender");
  const receiver = resolveCompanyName(repo, extraction.field2_receiver_name!, "receiver");

  const built = buildDestinationPath(
    config.nasRoot,
    sender.canonicalName,
    receiver.canonicalName,
    extraction,
    receivedAt,
    extension
  );

  writeOrSpool(
    repo,
    whatsappMessageId,
    built.relativePath,
    imageBuffer,
    sender.canonicalName,
    receiver.canonicalName
  );

  if (sender.needsConfirmation || receiver.needsConfirmation) {
    await notifyFiled(built.relativePath, {
      newSender: sender.needsConfirmation,
      newReceiver: receiver.needsConfirmation,
    });
  }
}

function writeOrSpool(
  repo: Repository,
  whatsappMessageId: string,
  relativePath: string,
  data: Buffer,
  canonicalSender: string,
  canonicalReceiver: string
): void {
  if (checkNasHealthy()) {
    const absolutePath = writeToNas(relativePath, data);
    repo.markFiled(whatsappMessageId, canonicalSender, canonicalReceiver, absolutePath);
  } else {
    // Let op: hier bewust het RELATIEVE pad opslaan (niet met nasRoot
    // samengevoegd) — flushPendingSpool() in nasWriter.ts geeft dit later
    // ongewijzigd door aan writeToNas(), dat zelf nasRoot ervoor plakt.
    spoolPending(whatsappMessageId, relativePath, data);
    repo.markPendingNas(whatsappMessageId, canonicalSender, canonicalReceiver, relativePath);
  }
}

function writeOrSpoolForReview(
  repo: Repository,
  whatsappMessageId: string,
  relativePath: string,
  data: Buffer,
  reason: string
): void {
  if (checkNasHealthy()) {
    const absolutePath = writeToNas(relativePath, data);
    repo.markFiledToReview(whatsappMessageId, "", "", absolutePath, reason);
  } else {
    // Status blijft 'pending_nas' (met reviewReason erbij) tot de flush
    // slaagt — zie de uitleg bij Repository.markPendingNas().
    spoolPending(whatsappMessageId, relativePath, data);
    repo.markPendingNas(whatsappMessageId, "", "", relativePath, reason);
  }
}
