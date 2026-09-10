import "dotenv/config";
import path from "node:path";

function bool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return value.toLowerCase() === "true" || value === "1";
}

// Let op: bewust GEEN eager-validatie hier. Dit bestand wordt ook getransitief
// geïmporteerd door modules die los van de API-key getest moeten kunnen worden
// (bv. aliasResolver.test.ts -> db/repository.ts -> config.ts). Verplichte
// waarden worden pas gecontroleerd op het punt waar ze echt nodig zijn, via
// assertAnthropicApiKeyConfigured()/assertWhatsappGroupConfigured() hieronder.
export const config = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",

  whatsappGroupJid: process.env.WHATSAPP_GROUP_JID ?? "",
  whatsappLogAllGroups: bool("WHATSAPP_LOG_ALL_GROUPS", false),
  notifyInWhatsapp: bool("NOTIFY_IN_WHATSAPP", false),

  nasRoot: path.resolve(process.env.NAS_ROOT ?? "./data/nas-local-test"),
  pendingSpoolDir: path.resolve(
    process.env.PENDING_SPOOL_DIR ?? "./data/pending-spool"
  ),
  databasePath: path.resolve(process.env.DATABASE_PATH ?? "./data/db.sqlite"),
  baileysAuthDir: path.resolve(
    process.env.BAILEYS_AUTH_DIR ?? "./data/baileys-auth"
  ),

  reviewFolderName: "_TE_CONTROLEREN",
} as const;

export function assertAnthropicApiKeyConfigured(): string {
  if (!config.anthropicApiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is niet ingesteld. Kopieer .env.example naar .env en vul 'm in."
    );
  }
  return config.anthropicApiKey;
}

export function assertWhatsappGroupConfigured(): string {
  if (!config.whatsappGroupJid) {
    throw new Error(
      "WHATSAPP_GROUP_JID is niet ingesteld. Zet WHATSAPP_LOG_ALL_GROUPS=true, " +
        "start de listener, stuur een testbericht in de groep, lees de JID uit de " +
        "logs en zet die in .env."
    );
  }
  return config.whatsappGroupJid;
}
