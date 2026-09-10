/**
 * Eenmalig te draaien: koppelt het zakelijke WhatsApp-nummer aan deze service
 * door een QR-code te tonen. De sessie wordt daarna persistent opgeslagen in
 * BAILEYS_AUTH_DIR, zodat dit bij een normale herstart niet opnieuw hoeft.
 *
 * Gebruik: npm run pair:whatsapp
 * Sluit af met Ctrl+C zodra in de console "[whatsapp] Verbonden." verschijnt.
 */
import { startWhatsappClient } from "../src/whatsapp/client.js";

console.log("WhatsApp-koppeling starten. Scan zo dadelijk de QR-code met het zakelijke nummer.\n");

await startWhatsappClient(async () => {
  // Tijdens het koppelen worden binnenkomende berichten genegeerd; dit
  // script dient alleen om de sessie eenmalig op te zetten.
});
