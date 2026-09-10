import type { CompanyRole, Repository } from "../db/repository.js";
import { nameSimilarity, sanitizeForFilesystem } from "./sanitize.js";

/** Vanaf welke gelijkenis (0..1) twee bedrijfsnamen als "waarschijnlijk dezelfde partij" gelden. */
const FUZZY_MATCH_THRESHOLD = 0.85;

export interface ResolvedCompany {
  /** De uiteindelijke, gesanitizede mapnaam om te gebruiken. */
  canonicalName: string;
  /** True als dit de allereerste keer is dat deze partij wordt gezien. */
  isNewCompany: boolean;
  /**
   * True als een mens dit zou moeten bevestigen: ofwel een gloednieuwe partij,
   * ofwel een fuzzy-match met een bestaande naam die nog niet bevestigd is.
   * Blokkeert het wegschrijven NIET — het bestand wordt gewoon gefiled onder
   * canonicalName; dit is puur een signaal voor de lichte review-lijst.
   */
  needsConfirmation: boolean;
  reason: "exact_match" | "fuzzy_match" | "new_company";
}

/**
 * Zoekt/maakt de canonieke mapnaam voor een door de vision-extractie
 * teruggegeven bedrijfsnaam. Voorkomt dat kleine schrijfverschillen
 * ("Wilko Fruit B.V." vs "WILKO FRUIT BV") tot losse mappen leiden.
 */
export function resolveCompanyName(
  repo: Repository,
  rawName: string,
  role: CompanyRole
): ResolvedCompany {
  const exact = repo.findAlias(rawName);
  if (exact) {
    return {
      canonicalName: exact.canonical_name,
      isNewCompany: false,
      needsConfirmation: exact.confirmed === 0,
      reason: "exact_match",
    };
  }

  const existingCanonicalNames = uniqueCanonicalNames(repo);
  let bestMatch: { name: string; score: number } | null = null;
  for (const canonical of existingCanonicalNames) {
    const score = nameSimilarity(rawName, canonical);
    if (score >= FUZZY_MATCH_THRESHOLD && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { name: canonical, score };
    }
  }

  if (bestMatch) {
    repo.insertAlias(rawName, bestMatch.name, role, false);
    return {
      canonicalName: bestMatch.name,
      isNewCompany: false,
      needsConfirmation: true,
      reason: "fuzzy_match",
    };
  }

  const canonicalName = sanitizeForFilesystem(rawName);
  repo.insertAlias(rawName, canonicalName, role, false);
  return {
    canonicalName,
    isNewCompany: true,
    needsConfirmation: true,
    reason: "new_company",
  };
}

function uniqueCanonicalNames(repo: Repository): string[] {
  const all = repo.listAllAliases();
  return Array.from(new Set(all.map((a) => a.canonical_name)));
}
