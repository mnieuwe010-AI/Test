import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  type WASocket,
  type proto,
} from "@whiskeysockets/baileys";
import type { Boom } from "@hapi/boom";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { config } from "../config.js";
import { setActiveSocket } from "../notify/whatsappReply.js";

export const baileysLogger = pino({ level: "warn" });

export type MessageUpsertHandler = (
  sock: WASocket,
  messages: proto.IWebMessageInfo[]
) => Promise<void>;

/**
 * Start (of herstart na een verbroken verbinding) de Baileys-socket. De
 * WhatsApp-sessie wordt persistent opgeslagen in config.baileysAuthDir, dus
 * na de eenmalige QR-koppeling (npm run pair:whatsapp) is geen nieuwe scan
 * nodig bij een herstart van het proces.
 */
export async function startWhatsappClient(
  onMessagesUpsert: MessageUpsertHandler
): Promise<WASocket> {
  const { state, saveCreds } = await useMultiFileAuthState(config.baileysAuthDir);

  const sock = makeWASocket({
    auth: state,
    logger: baileysLogger,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("[whatsapp] Scan deze QR-code met het zakelijke WhatsApp-nummer:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("[whatsapp] Verbonden.");
      setActiveSocket(sock);
    }

    if (connection === "close") {
      setActiveSocket(null);
      const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      if (loggedOut) {
        console.error(
          "[whatsapp] Sessie is uitgelogd. Verwijder de map in BAILEYS_AUTH_DIR en " +
            "koppel opnieuw met: npm run pair:whatsapp"
        );
        return;
      }

      console.warn(`[whatsapp] Verbinding verbroken (code ${statusCode}), opnieuw verbinden...`);
      startWhatsappClient(onMessagesUpsert).catch((err) =>
        console.error("[whatsapp] Herverbinden mislukt:", err)
      );
    }
  });

  sock.ev.on("messages.upsert", (upsert) => {
    if (upsert.type !== "notify") return;
    onMessagesUpsert(sock, upsert.messages).catch((err) =>
      console.error("[whatsapp] Fout bij verwerken van binnenkomende berichten:", err)
    );
  });

  return sock;
}
