import { Repository } from "./db/repository.js";
import { checkNasHealthy, flushPendingSpool } from "./storage/nasWriter.js";
import { startWhatsappClient } from "./whatsapp/client.js";
import { handleMessages } from "./whatsapp/listener.js";

const FLUSH_INTERVAL_MS = 5 * 60 * 1000; // elke 5 minuten proberen gespoolde bonnen alsnog te filen

async function main(): Promise<void> {
  console.log("[index] CMR-bonnen automatisering start...");

  const repo = new Repository();

  logStuckMessages(repo);

  if (!checkNasHealthy()) {
    console.warn(
      "[index] NAS_ROOT is bij opstarten niet bereikbaar — bonnen worden tijdelijk " +
        "lokaal gespoold totdat de verbinding hersteld is."
    );
  }

  await startWhatsappClient((sock, messages) => handleMessages(repo, sock, messages));

  setInterval(() => {
    const { flushed, stillPending } = flushPendingSpool(repo);
    if (flushed > 0) {
      console.log(`[index] ${flushed} eerder gespoolde bon(nen) alsnog naar de NAS geschreven.`);
    }
    if (stillPending > 0) {
      console.warn(`[index] ${stillPending} bon(nen) wachten nog op een bereikbare NAS.`);
    }
  }, FLUSH_INTERVAL_MS);

  const shutdown = () => {
    console.log("[index] Afsluiten...");
    repo.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function logStuckMessages(repo: Repository): void {
  const unfinished = repo.getUnfinished();
  const stuck = unfinished.filter((r) => r.status === "received" || r.status === "extracted");
  if (stuck.length === 0) return;

  console.warn(
    `[index] ${stuck.length} bericht(en) stonden nog "in bewerking" bij de vorige afsluiting ` +
      "(waarschijnlijk door een crash of herstart). De ruwe foto van deze tussenstadia is niet " +
      "lokaal bewaard, dus automatisch hervatten kan niet — WhatsApp levert recente berichten " +
      "vaak opnieuw af bij een herverbinding; check anders handmatig de volgende bericht-ID's: " +
      stuck.map((r) => r.whatsapp_message_id).join(", ")
  );
}

main().catch((err) => {
  console.error("[index] Fatale opstartfout:", err);
  process.exit(1);
});
