/**
 * Standalone testtool, los van WhatsApp/NAS: leest één foto van disk en
 * stuurt 'm door de Claude-extractie, zodat de promptkwaliteit en het
 * schema geverifieerd kunnen worden tegen bekende voorbeeldbonnen.
 *
 * Gebruik: npm run cli:extract -- pad/naar/foto.jpg
 */
import fs from "node:fs";
import path from "node:path";
import { extractCmrFromImage } from "../src/extraction/claudeClient.js";
import { decideRouting } from "../src/extraction/types.js";

const imagePath = process.argv[2];
if (!imagePath) {
  console.error("Gebruik: npm run cli:extract -- <pad-naar-foto.jpg>");
  process.exit(1);
}

const resolvedPath = path.resolve(imagePath);
if (!fs.existsSync(resolvedPath)) {
  console.error(`Bestand niet gevonden: ${resolvedPath}`);
  process.exit(1);
}

const buffer = fs.readFileSync(resolvedPath);

console.log(`Extraheren van ${resolvedPath} ...`);
const result = await extractCmrFromImage(buffer);

console.log("\n=== Geëxtraheerde velden ===");
console.log(JSON.stringify(result, null, 2));

const routing = decideRouting(result);
console.log("\n=== Routeringsbeslissing ===");
console.log(routing);
