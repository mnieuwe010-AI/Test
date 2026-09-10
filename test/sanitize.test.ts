import { describe, expect, it } from "vitest";
import {
  nameSimilarity,
  normalizeCompanyName,
  sanitizeForFilesystem,
} from "../src/canonicalize/sanitize.js";

describe("sanitizeForFilesystem", () => {
  it("vervangt een '/' in een bedrijfsnaam (echt geval uit een CMR-bon)", () => {
    expect(sanitizeForFilesystem("Jacobs / Cooperatie Hoogstraten")).toBe(
      "Jacobs - Cooperatie Hoogstraten"
    );
  });

  it("vervangt overige bestandsonveilige tekens", () => {
    expect(sanitizeForFilesystem('Bedrijf: "Test" <NV> | *?')).not.toMatch(/[/\\:*?"<>|]/);
  });

  it("trimt spaties en verwijdert een afsluitende punt", () => {
    expect(sanitizeForFilesystem("  Wilko Fruit B.V. .  ")).toBe("Wilko Fruit B.V");
  });

  it("strip alleen de afsluitende punt, de rest blijft intact", () => {
    expect(sanitizeForFilesystem("Wilko Fruit B.V.")).toBe("Wilko Fruit B.V");
  });

  it("geeft nooit een lege string terug", () => {
    expect(sanitizeForFilesystem("   ///   ")).toBe("ONBEKEND");
  });

  it("beperkt de lengte defensief", () => {
    const long = "A".repeat(300);
    expect(sanitizeForFilesystem(long).length).toBeLessThanOrEqual(120);
  });
});

describe("normalizeCompanyName", () => {
  it("normaliseert B.V.-varianten naar dezelfde vorm", () => {
    expect(normalizeCompanyName("Wilko Fruit B.V.")).toBe(
      normalizeCompanyName("WILKO FRUIT BV")
    );
  });
});

describe("nameSimilarity", () => {
  it("herkent B.V./BV-schrijfvarianten als (bijna) identiek", () => {
    expect(nameSimilarity("Wilko Fruit B.V.", "WILKO FRUIT BV")).toBeGreaterThan(0.95);
  });

  it("geeft een lage score voor duidelijk verschillende namen", () => {
    expect(nameSimilarity("Wilko Fruit B.V.", "De Mooij Zoetermeer B.V.")).toBeLessThan(0.6);
  });

  it("is 1 voor identieke input", () => {
    expect(nameSimilarity("Jacobs - Cooperatie Hoogstraten", "Jacobs - Cooperatie Hoogstraten")).toBe(
      1
    );
  });
});
