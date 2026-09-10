import { config } from "../config.js";

/**
 * Minimale koppeling met de actieve Baileys-socket, zodat pipeline.ts geen
 * directe afhankelijkheid van whatsapp/client.ts nodig heeft (voorkomt een
 * circulaire import: client -> listener -> pipeline -> notify -> client).
 * whatsapp/client.ts roept setActiveSocket() aan zodra de verbinding staat.
 */
type MinimalSocket = {
  sendMessage: (jid: string, content: { text: string }) => Promise<unknown>;
};

let activeSocket: MinimalSocket | null = null;

export function setActiveSocket(socket: MinimalSocket | null): void {
  activeSocket = socket;
}

async function send(text: string): Promise<void> {
  if (!config.notifyInWhatsapp) return;
  if (!activeSocket || !config.whatsappGroupJid) {
    console.log(`[notify] (niet verstuurd, geen actieve verbinding/groep) ${text}`);
    return;
  }
  try {
    await activeSocket.sendMessage(config.whatsappGroupJid, { text });
  } catch (err) {
    console.error("[notify] versturen van WhatsApp-bevestiging mislukt:", (err as Error).message);
  }
}

export async function notifyFiled(
  relativePath: string,
  flags: { newSender: boolean; newReceiver: boolean }
): Promise<void> {
  const notes: string[] = [];
  if (flags.newSender) notes.push("nieuwe/onbevestigde afzendernaam");
  if (flags.newReceiver) notes.push("nieuwe/onbevestigde ontvangernaam");
  const suffix = notes.length ? ` ⚠️ (${notes.join(", ")} — even controleren)` : "";
  await send(`✅ CMR-bon verwerkt en opgeslagen: ${relativePath}${suffix}`);
}

export async function notifyReviewNeeded(reason: string, relativePath: string): Promise<void> {
  await send(`⚠️ CMR-bon kon niet automatisch worden gefiled (${reason}). Zie: ${relativePath}`);
}
