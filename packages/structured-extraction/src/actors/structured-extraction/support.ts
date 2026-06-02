import { createHash } from "node:crypto";
import type { ArtifactRef } from "artifact-contracts";
import type { ClassifiedError, LlmArtifactKind, LlmCapabilityRequirements, LlmInputModality } from "llm-contracts";
import type { SchemaRef } from "schema-contracts";
import type { JsonValue } from "typed-actors";

const EXTRACTION_SCHEMA_PROMPT_CHAR_LIMIT = 12_000;

const CODE_EXTENSIONS = new Set([
  ".c", ".cc", ".cpp", ".cs", ".css", ".go", ".h", ".hpp", ".html", ".java", ".js", ".json", ".jsx", ".kt", ".mjs", ".php", ".py", ".rb", ".rs", ".scala", ".sh", ".sql", ".swift", ".ts", ".tsx", ".xml", ".yaml", ".yml",
]);

function extension(filename: string | undefined): string | undefined {
  if (!filename) return undefined;
  const index = filename.lastIndexOf(".");
  return index >= 0 ? filename.slice(index).toLowerCase() : undefined;
}

function normalizeMime(mime: string | undefined): string | undefined {
  return mime?.split(";")[0]?.trim().toLowerCase();
}

export type StructuredExtractionArtifactKind = Exclude<LlmArtifactKind, "audio">;

function requirementModalityForKind(kind: StructuredExtractionArtifactKind): LlmInputModality {
  switch (kind) {
    case "image":
      return "image";
    case "pdf":
      return "pdf";
    case "text":
    case "code":
    case "document":
    case "presentation":
    case "spreadsheet":
      return "text";
  }
}

export function inferStructuredExtractionArtifactKind(input: {
  readonly effectiveMimeType?: string;
  readonly filename?: string;
}): StructuredExtractionArtifactKind | undefined {
  const mime = normalizeMime(input.effectiveMimeType);
  const ext = extension(input.filename);
  if (mime?.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime === "application/javascript" || mime === "text/javascript" || mime === "text/typescript") return "code";
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || mime === "application/msword") return "document";
  if (mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation" || mime === "application/vnd.ms-powerpoint") return "presentation";
  if (mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || mime === "application/vnd.ms-excel" || mime === "text/csv" || mime === "text/tsv") return "spreadsheet";
  if (mime === "application/json" || mime === "application/xml" || mime?.startsWith("text/")) {
    if (mime === "text/csv" || mime === "text/tsv") return "spreadsheet";
    if (ext && CODE_EXTENSIONS.has(ext)) return "code";
    return "text";
  }
  if (mime?.startsWith("audio/")) return undefined;
  if (!mime || mime === "application/octet-stream") {
    switch (ext) {
      case ".png":
      case ".jpg":
      case ".jpeg":
      case ".gif":
      case ".webp":
        return "image";
      case ".pdf":
        return "pdf";
      case ".doc":
      case ".docx":
        return "document";
      case ".ppt":
      case ".pptx":
        return "presentation";
      case ".xls":
      case ".xlsx":
      case ".csv":
      case ".tsv":
        return "spreadsheet";
      default:
        if (ext && CODE_EXTENSIONS.has(ext)) return "code";
        if (ext === ".txt" || ext === ".md" || ext === ".json" || ext === ".xml") return "text";
    }
  }
  return undefined;
}

export function defaultRequirementsForKind(kind: StructuredExtractionArtifactKind): LlmCapabilityRequirements {
  return {
    input: { modalities: ["text", requirementModalityForKind(kind)] },
    output: { modalities: ["text", "json"] },
    general: { requires: ["structuredOutput"] },
  };
}

export function effectiveRequirementsForKind(
  kind: StructuredExtractionArtifactKind,
  requested?: LlmCapabilityRequirements,
): LlmCapabilityRequirements {
  const defaults = defaultRequirementsForKind(kind);
  const outputModalities = new Set([...(defaults.output?.modalities ?? []), ...(requested?.output?.modalities ?? [])]);
  const generalRequires = new Set([...(defaults.general?.requires ?? []), ...(requested?.general?.requires ?? [])]);
  return {
    input: defaults.input,
    ...(outputModalities.size === 0 ? {} : { output: { modalities: [...outputModalities] } }),
    ...(generalRequires.size === 0 ? {} : { general: { requires: [...generalRequires] } }),
  };
}

export function buildExtractionPrompt(input: {
  readonly schemaRef: SchemaRef;
  readonly schemaName?: string;
  readonly schemaDescription?: string;
  readonly schemaSystemPrompt?: string;
  readonly schemaJson?: JsonValue;
  readonly instruction?: string;
}): string {
  const parts = [
    "You are a structured extraction engine.",
    `Extract data from the attached artifact according to schema ${input.schemaRef.schemaId}@${input.schemaRef.version}.`,
    "Return only JSON matching the schema.",
    "Do not invent values. Use null, empty strings, or empty arrays according to the schema when a value is absent.",
    "Preserve original currencies, dates, invoice numbers, names, and line item text as seen.",
    "Follow the current schema field names and nesting exactly; do not use legacy or synonymous field names.",
    "Emit JSON numbers as numbers, not quoted strings.",
  ];
  if (input.schemaName) parts.push(`Schema name: ${input.schemaName}`);
  if (input.schemaDescription) parts.push(`Schema description: ${input.schemaDescription}`);
  if (input.schemaSystemPrompt) parts.push(`Schema system prompt: ${input.schemaSystemPrompt}`);
  if (input.schemaJson !== undefined) {
    const schemaText = JSON.stringify(input.schemaJson, null, 2);
    const boundedSchemaText = schemaText.length > EXTRACTION_SCHEMA_PROMPT_CHAR_LIMIT
      ? `${schemaText.slice(0, EXTRACTION_SCHEMA_PROMPT_CHAR_LIMIT)}\n... [schema truncated for prompt length]`
      : schemaText;
    parts.push(`Schema JSON (authoritative; follow property names, nesting, required fields, enums, and additionalProperties exactly):\n${boundedSchemaText}`);
  }
  if (input.instruction) parts.push(`Instruction: ${input.instruction}`);
  return parts.join("\n\n");
}

export function buildSchemaRepairPrompt(input: {
  readonly basePrompt: string;
  readonly validationDetails?: JsonValue;
  readonly previousCandidateValue?: JsonValue;
}): string {
  const validationSummary = JSON.stringify(input.validationDetails ?? null, null, 2);
  const previousCandidateSummary = input.previousCandidateValue === undefined
    ? undefined
    : JSON.stringify(input.previousCandidateValue, null, 2);
  return [
    input.basePrompt,
    "Previous output failed schema validation.",
    ...(previousCandidateSummary === undefined
      ? []
      : [
          "Here is the previous candidate JSON that was closest to the target schema. Repair this exact object instead of starting over:",
          previousCandidateSummary,
        ]),
    "Produce one corrected JSON object that satisfies the schema exactly.",
    "Remove unsupported properties, use only allowed enum values, and ensure all required properties are present.",
    "When validation reports additionalProperties errors, delete those properties entirely instead of renaming them to new unsupported fields.",
    "When validation reports required-property errors, repair the object by filling the required property from the source content or from an obviously corresponding sibling field, then remove the invalid sibling field if the schema does not allow it.",
    "For arrays of objects, repair each item individually and ensure every item contains only schema-allowed properties.",
    "Do not add currency helper fields, tax helper fields, total helper fields, or similarly named convenience properties unless the schema explicitly defines them.",
    "Before returning, self-check that every object respects additionalProperties: false wherever specified by the schema.",
    "Validation errors from the previous attempt:",
    validationSummary,
  ].join("\n\n");
}

export function pruneJsonToSchema(value: JsonValue, schema: JsonValue | undefined): JsonValue {
  if (!schema || typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return value;
  }
  if (Array.isArray(value)) {
    const itemSchema = isRecord(schema) ? schema.items : undefined;
    return value.map((entry) => pruneJsonToSchema(entry, itemSchema as JsonValue | undefined));
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const record = value as Record<string, JsonValue>;
  const schemaRecord = schema as Record<string, unknown>;
  const properties = isRecord(schemaRecord.properties) ? schemaRecord.properties as Record<string, unknown> : undefined;
  const disallowAdditional = schemaRecord.additionalProperties === false;
  const nextEntries: Array<[string, JsonValue]> = [];
  for (const [key, entryValue] of Object.entries(record)) {
    const propertySchema = properties?.[key];
    if (propertySchema !== undefined) {
      nextEntries.push([key, pruneJsonToSchema(entryValue, propertySchema as JsonValue)]);
      continue;
    }
    if (!disallowAdditional) {
      nextEntries.push([key, entryValue]);
    }
  }
  return Object.fromEntries(nextEntries) as JsonValue;
}

export function extractCandidateValueFromValidationDetails(details: JsonValue | undefined): JsonValue | undefined {
  if (typeof details !== "object" || details === null || Array.isArray(details)) {
    return undefined;
  }
  const candidateValue = (details as Record<string, JsonValue>).candidateValue;
  return candidateValue === undefined ? undefined : candidateValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function deterministicExtractionIdempotencyKey(artifact: ArtifactRef, schemaRef: SchemaRef, instruction?: string): string {
  const instructionHash = createHash("sha256").update(instruction ?? "").digest("hex");
  return `structured-extraction:${artifact.artifactId}:${schemaRef.schemaId}@${schemaRef.version}:${instructionHash}`;
}

export function structuredExtractionError(
  category: ClassifiedError["category"],
  code: string,
  message: string,
  details?: JsonValue,
): ClassifiedError {
  return {
    category,
    code,
    message,
    ...(details === undefined ? {} : { details }),
  };
}