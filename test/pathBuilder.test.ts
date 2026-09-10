import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDestinationPath, buildReviewPath } from "../src/storage/pathBuilder.js";
import type { CmrExtractionResult } from "../src/extraction/types.js";

function baseExtraction(overrides: Partial<CmrExtractionResult> = {}): CmrExtractionResult {
  return {
    is_cmr_document: true,
    document_confidence: "high",
    legibility_notes: null,
    field1_sender_name: "Wilko Fruit B.V.",
    field1_sender_address: "Heilaar Noordweg 14, Prinsenbeek",
    field2_receiver_name: "Jacobs / Cooperatie Hoogstraten",
    field2_receiver_address: "Loenhoutseweg 59, Hoogstraten",
    field3_delivery_place: "Slikgat 4, Meerle",
    field4_pickup_place: "Prinsenbeek",
    field4_pickup_date: "2026-09-09",
    field13_order_number: "131165",
    field13_reference_number: "300_CMR_131165_Jacobs / Cooperatie Hoogstraten_09/09/2026",
    field13_instructions_text: "Ordernumber: 131165",
    field16_carrier_name: "De Mooij Zoetermeer B.V.",
    field21_place_date_drawn_up: "Prinsenbeek, 9-9-2026",
    goods_summary: "Soft fruit, 13.680 dozen, 11,9 pallets",
    goods_total_weight_kg: 7795,
    goods_total_packages: 13680,
    field1_present_and_legible: true,
    field2_present_and_legible: true,
    ...overrides,
  };
}

describe("buildDestinationPath", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cmr-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("bouwt {sender}/{receiver}/{datum}_{order}_{ref}.ext op basis van de canonieke namen", () => {
    const result = buildDestinationPath(
      tmpRoot,
      "Wilko Fruit B.V",
      "Jacobs - Cooperatie Hoogstraten",
      baseExtraction(),
      new Date("2026-09-09T08:12:00Z"),
      "jpg"
    );

    expect(result.senderFolder).toBe("Wilko Fruit B.V");
    expect(result.receiverFolder).toBe("Jacobs - Cooperatie Hoogstraten");
    expect(result.filename).toMatch(/^2026-09-09_131165_/);
    expect(result.filename.endsWith(".jpg")).toBe(true);
    expect(result.relativePath).toBe(
      `Wilko Fruit B.V/Jacobs - Cooperatie Hoogstraten/${result.filename}`
    );
  });

  it("valt terug op de ontvangstdatum als vak 4 niet parseerbaar is", () => {
    const result = buildDestinationPath(
      tmpRoot,
      "Wilko Fruit B.V",
      "Jacobs - Cooperatie Hoogstraten",
      baseExtraction({ field4_pickup_date: "onleesbaar" }),
      new Date("2026-09-10T08:12:00Z"),
      "jpg"
    );

    expect(result.filename.startsWith("2026-09-10_")).toBe(true);
  });

  it("voorkomt overschrijven: voegt _2 toe bij een botsende bestandsnaam", () => {
    const first = buildDestinationPath(
      tmpRoot,
      "Wilko Fruit B.V",
      "Jacobs - Cooperatie Hoogstraten",
      baseExtraction(),
      new Date("2026-09-09T08:12:00Z"),
      "jpg"
    );
    fs.mkdirSync(path.dirname(path.join(tmpRoot, first.relativePath)), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, first.relativePath), "dummy");

    const second = buildDestinationPath(
      tmpRoot,
      "Wilko Fruit B.V",
      "Jacobs - Cooperatie Hoogstraten",
      baseExtraction(),
      new Date("2026-09-09T08:12:00Z"),
      "jpg"
    );

    expect(second.filename).not.toBe(first.filename);
    expect(second.filename).toMatch(/_2\.jpg$/);
  });

  it("gebruikt GEEN-ORDERNR als er geen ordernummer is uitgelezen", () => {
    const result = buildDestinationPath(
      tmpRoot,
      "Wilko Fruit B.V",
      "Jacobs - Cooperatie Hoogstraten",
      baseExtraction({ field13_order_number: null }),
      new Date("2026-09-09T08:12:00Z"),
      "jpg"
    );
    expect(result.filename).toContain("GEEN-ORDERNR");
  });
});

describe("buildReviewPath", () => {
  it("legt het bestand in de review-map, niet in een leverancier/klant-map", () => {
    const result = buildReviewPath(
      "/nas",
      "_TE_CONTROLEREN",
      "ABCD1234EFGH",
      new Date("2026-09-09T08:12:00Z"),
      "jpg"
    );
    expect(result.relativePath.startsWith("_TE_CONTROLEREN/")).toBe(true);
  });
});
