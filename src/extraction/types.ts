export type DocumentConfidence = "high" | "medium" | "low";

/** Spiegelt het tool-schema in claudeClient.ts — hou ze in sync. */
export interface CmrExtractionResult {
  is_cmr_document: boolean;
  document_confidence: DocumentConfidence;
  legibility_notes: string | null;

  field1_sender_name: string | null;
  field1_sender_address: string | null;
  field2_receiver_name: string | null;
  field2_receiver_address: string | null;
  field3_delivery_place: string | null;
  field4_pickup_place: string | null;
  field4_pickup_date: string | null;
  field13_order_number: string | null;
  field13_reference_number: string | null;
  field13_instructions_text: string | null;
  field16_carrier_name: string | null;
  field21_place_date_drawn_up: string | null;

  goods_summary: string | null;
  goods_total_weight_kg: number | null;
  goods_total_packages: number | null;

  field1_present_and_legible: boolean;
  field2_present_and_legible: boolean;
}

export type RoutingDecision =
  | { action: "skip_not_cmr" }
  | { action: "needs_review"; reason: string }
  | { action: "file" };

/**
 * De "is dit bruikbaar"-beslissing wordt in code genomen (deterministisch,
 * auditeerbaar) op basis van de door het model teruggegeven signalen —
 * niet aan het model zelf overgelaten.
 */
export function decideRouting(result: CmrExtractionResult): RoutingDecision {
  if (!result.is_cmr_document) {
    return { action: "skip_not_cmr" };
  }

  if (!result.field1_present_and_legible) {
    return { action: "needs_review", reason: "Veld 1 (afzender) ontbreekt of is onleesbaar" };
  }
  if (!result.field2_present_and_legible) {
    return { action: "needs_review", reason: "Veld 2 (geadresseerde) ontbreekt of is onleesbaar" };
  }
  if (result.document_confidence === "low") {
    return { action: "needs_review", reason: "Lage leesbaarheid/betrouwbaarheid van het document" };
  }
  if (!result.field1_sender_name?.trim() || !result.field2_receiver_name?.trim()) {
    return { action: "needs_review", reason: "Afzender- of ontvangernaam ontbreekt na extractie" };
  }

  return { action: "file" };
}
