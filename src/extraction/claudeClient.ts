import Anthropic from "@anthropic-ai/sdk";
import { assertAnthropicApiKeyConfigured } from "../config.js";
import type { CmrExtractionResult } from "./types.js";

const MODEL = "claude-sonnet-5";

const CMR_PROMPT = `Je krijgt een foto van een CMR-vrachtbrief (internationaal wegtransport-document,
CMR-verdrag). Dit is een gestandaardiseerd formulier met genummerde vakken 1-24 die er ongeveer
zo uitzien:

- Vak 1: Afzender/Expediteur (naam + adres van de leverancier die verstuurt)
- Vak 2: Geadresseerde (naam + adres van de klant/ontvanger)
- Vak 3: Plaats bestemd voor aflevering
- Vak 4: Plaats en datum van inontvangstneming (ophaaldatum/-plaats)
- Vak 6-12: goederenomschrijving, verpakking, aantallen, gewicht
- Vak 13: Instructies afzender — bevat vaak een ordernummer en/of referentienummer
  (bv. "Ordernumber: 131165" en een Refnumber-regel)
- Vak 16: Transporteur (het wegvervoerbedrijf)
- Vak 21: plaats en datum waar het document is opgemaakt
- Vak 22/23/24: handtekeningen van afzender, vervoerder, ontvanger

De foto is door een chauffeur of medewerker met een telefoon gemaakt en kan scheef,
donker, vervormd, deels bedekt (bv. door een voet of vinger) of met beperkte resolutie zijn.
Lees zo nauwkeurig mogelijk wat er daadwerkelijk staat. Verzin GEEN waarden die je niet kunt
lezen — vul dan null in en zet de bijbehorende *_present_and_legible vlag op false.

Roep de tool "record_cmr_extraction" aan met je bevindingen.`;

const CMR_TOOL: Anthropic.Tool = {
  name: "record_cmr_extraction",
  description:
    "Legt de gestructureerde velden van een gefotografeerde CMR-vrachtbrief vast.",
  input_schema: {
    type: "object",
    properties: {
      is_cmr_document: {
        type: "boolean",
        description:
          "True als dit herkenbaar een CMR-vrachtbrief/internationaal transportdocument is, " +
          "false als het een andere foto is (bv. gewone chatfoto, onderweg-foto, iets anders).",
      },
      document_confidence: {
        type: "string",
        enum: ["high", "medium", "low"],
        description: "Hoe zeker/leesbaar is het document als geheel.",
      },
      legibility_notes: {
        type: ["string", "null"],
        description: "Korte notitie over leesbaarheidsproblemen, bv. 'vak 2 deels bedekt'.",
      },

      field1_sender_name: { type: ["string", "null"] },
      field1_sender_address: { type: ["string", "null"] },
      field2_receiver_name: { type: ["string", "null"] },
      field2_receiver_address: { type: ["string", "null"] },
      field3_delivery_place: { type: ["string", "null"] },
      field4_pickup_place: { type: ["string", "null"] },
      field4_pickup_date: {
        type: ["string", "null"],
        description: "ISO-datum (YYYY-MM-DD) indien te herleiden, anders de ruwe tekst.",
      },
      field13_order_number: { type: ["string", "null"] },
      field13_reference_number: { type: ["string", "null"] },
      field13_instructions_text: {
        type: ["string", "null"],
        description: "De volledige tekst uit vak 13, als aanvulling op de losse velden hierboven.",
      },
      field16_carrier_name: { type: ["string", "null"] },
      field21_place_date_drawn_up: { type: ["string", "null"] },

      goods_summary: {
        type: ["string", "null"],
        description: "Vrije samenvatting van de goederen/verpakking (vakken 6-9).",
      },
      goods_total_weight_kg: { type: ["number", "null"] },
      goods_total_packages: { type: ["number", "null"] },

      field1_present_and_legible: {
        type: "boolean",
        description: "True alleen als vak 1 (afzender) aanwezig EN leesbaar is.",
      },
      field2_present_and_legible: {
        type: "boolean",
        description: "True alleen als vak 2 (geadresseerde) aanwezig EN leesbaar is.",
      },
    },
    required: [
      "is_cmr_document",
      "document_confidence",
      "legibility_notes",
      "field1_sender_name",
      "field1_sender_address",
      "field2_receiver_name",
      "field2_receiver_address",
      "field3_delivery_place",
      "field4_pickup_place",
      "field4_pickup_date",
      "field13_order_number",
      "field13_reference_number",
      "field13_instructions_text",
      "field16_carrier_name",
      "field21_place_date_drawn_up",
      "goods_summary",
      "goods_total_weight_kg",
      "goods_total_packages",
      "field1_present_and_legible",
      "field2_present_and_legible",
    ],
  },
};

export type SupportedImageMediaType = "image/jpeg" | "image/png" | "image/webp";

/** Detecteert het mediatype op basis van de magic bytes; valt terug op jpeg. */
export function detectImageMediaType(buffer: Buffer): SupportedImageMediaType {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e) {
    return "image/png";
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return "image/jpeg";
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: assertAnthropicApiKeyConfigured() });
  }
  return client;
}

export async function extractCmrFromImage(
  imageBuffer: Buffer,
  mediaType?: SupportedImageMediaType
): Promise<CmrExtractionResult> {
  const resolvedMediaType = mediaType ?? detectImageMediaType(imageBuffer);

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1500,
    tools: [CMR_TOOL],
    tool_choice: { type: "tool", name: "record_cmr_extraction" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: resolvedMediaType,
              data: imageBuffer.toString("base64"),
            },
          },
          { type: "text", text: CMR_PROMPT },
        ],
      },
    ],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );
  if (!toolUse) {
    throw new Error(
      "Claude gaf geen tool_use-blok terug voor de CMR-extractie — onverwachte API-respons."
    );
  }

  return toolUse.input as CmrExtractionResult;
}
