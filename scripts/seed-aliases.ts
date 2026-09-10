/**
 * Zet de alias-tabel op met de al bekende vaste relaties, zodat deze niet
 * pas na de eerste (mogelijk licht anders geschreven) bon als "nieuwe partij"
 * worden gemarkeerd. Veilig om opnieuw te draaien (upsert op raw_variant).
 *
 * Gebruik: npm run seed:aliases
 */
import { Repository, type CompanyRole } from "../src/db/repository.js";

interface SeedEntry {
  rawVariant: string;
  canonicalName: string;
  role: CompanyRole;
}

const seedData: SeedEntry[] = [
  { rawVariant: "Wilko Fruit B.V.", canonicalName: "Wilko Fruit B.V.", role: "both" },
  {
    rawVariant: "Jacobs / Cooperatie Hoogstraten",
    canonicalName: "Jacobs - Cooperatie Hoogstraten",
    role: "both",
  },
];

const repo = new Repository();

for (const entry of seedData) {
  repo.insertAlias(entry.rawVariant, entry.canonicalName, entry.role, true);
  console.log(`Geseed: "${entry.rawVariant}" -> "${entry.canonicalName}" (${entry.role}, bevestigd)`);
}

repo.close();
console.log("\nKlaar. Vul scripts/seed-aliases.ts verder aan met andere vaste relaties naar wens.");
