/**
 * Maakt een string veilig om als map- of bestandsnaam te gebruiken op zowel
 * Windows/SMB als Linux. Concreet geval uit een echte CMR: "Jacobs / Cooperatie
 * Hoogstraten" bevat een "/" — een padscheidingsteken — die anders per ongeluk
 * een geneste map zou aanmaken.
 */
export function sanitizeForFilesystem(raw: string): string {
  let s = raw.trim();

  // Illegale/problematische tekens op Windows, SMB-shares en de meeste NAS'en.
  s = s.replace(/[/\\:*?"<>|]/g, "-");

  // Spaties/koppeltekens die door de vervanging zijn opgestapeld, normaliseren.
  s = s.replace(/\s+/g, " ");
  s = s.replace(/-{2,}/g, "-");
  s = s.replace(/\s*-\s*/g, " - ");

  s = s.trim();
  // Windows staat geen namen toe die eindigen op een punt of spatie.
  s = s.replace(/[.\s]+$/g, "");

  // Defensieve lengtebeperking (NTFS/SMB pad-limieten, met ruimte voor de rest
  // van het pad zoals {NAS_ROOT}/{sender}/{receiver}/{filename}).
  const MAX_LEN = 120;
  if (s.length > MAX_LEN) {
    s = s.slice(0, MAX_LEN).trim();
  }

  if (s.length === 0) {
    return "ONBEKEND";
  }

  return s;
}

/** Genormaliseerde sleutel voor gelijkheids-/fuzzy-vergelijking van bedrijfsnamen. */
export function normalizeCompanyName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\bb\.?v\.?\b/g, "bv") // "B.V." / "BV" / "b.v." -> "bv"
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Eenvoudige, afhankelijkheidsvrije gelijkenismaat (Levenshtein-afstand,
 * genormaliseerd naar 0..1 waarbij 1 = identiek) op de genormaliseerde namen.
 * Voldoende voor "Wilko Fruit B.V." vs "WILKO FRUIT BV"-achtige varianten;
 * geen zware fuzzy-matching library nodig op dit volume.
 */
export function nameSimilarity(a: string, b: string): number {
  const s1 = normalizeCompanyName(a);
  const s2 = normalizeCompanyName(b);
  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  const distance = levenshtein(s1, s2);
  const maxLen = Math.max(s1.length, s2.length);
  return 1 - distance / maxLen;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;

  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] =
        a[i - 1] === b[j - 1]
          ? prev
          : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}
