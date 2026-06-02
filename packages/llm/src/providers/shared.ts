import type { ArtifactStorage } from "../../../artifacts/src/subsystem.ts";
import type { ArtifactDescriptor } from "artifact-contracts";
import type {
  ClassifiedError,
  LlmArtifactInputCapability,
  LlmArtifactKind,
  LlmModelCapabilities,
  LlmRequest,
} from "llm-contracts";
import type { JsonValue } from "typed-actors";
import { clone, classifiedError } from "../support.ts";
import type { ResolvedLlmArtifactPart, ResolvedLlmRequest } from "./types.ts";

const CODE_EXTENSIONS = new Set([
  ".c", ".cc", ".cpp", ".cs", ".css", ".go", ".h", ".hpp", ".html", ".java", ".js", ".json", ".jsx", ".kt", ".mjs", ".php", ".py", ".rb", ".rs", ".scala", ".sh", ".sql", ".swift", ".ts", ".tsx", ".xml", ".yaml", ".yml",
]);

const DOCUMENT_MIME_TYPES = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/rtf",
  "application/vnd.oasis.opendocument.text",
]);

const PRESENTATION_MIME_TYPES = new Set([
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

const SPREADSHEET_MIME_TYPES = new Set([
  "text/csv",
  "text/tsv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const TEXT_MIME_TYPES = new Set(["application/json", "application/xml", "text/markdown"]);

function lower(value: string | undefined): string | undefined {
  return value?.toLowerCase();
}

function fileExtension(filename: string | undefined): string | undefined {
  if (!filename) return undefined;
  const lastDot = filename.lastIndexOf(".");
  return lastDot >= 0 ? filename.slice(lastDot).toLowerCase() : undefined;
}

export function isMimeAllowed(mime: string, accepted: readonly string[]): boolean {
  const normalizedMime = lower(mime) ?? mime;
  return accepted.some((entry) => {
    const normalizedEntry = lower(entry) ?? entry;
    if (normalizedEntry.endsWith("/*")) {
      return normalizedMime.startsWith(normalizedEntry.slice(0, -1));
    }
    return normalizedMime === normalizedEntry;
  });
}

export function artifactKindSupportsMime(kind: LlmArtifactKind, mime: string, filename?: string): boolean {
  const normalizedMime = lower(mime) ?? mime;
  switch (kind) {
    case "image":
      return normalizedMime.startsWith("image/");
    case "audio":
      return normalizedMime.startsWith("audio/");
    case "pdf":
      return normalizedMime === "application/pdf";
    case "text":
      return normalizedMime.startsWith("text/") || TEXT_MIME_TYPES.has(normalizedMime);
    case "code":
      return normalizedMime.startsWith("text/") || CODE_EXTENSIONS.has(fileExtension(filename) ?? "");
    case "document":
      return DOCUMENT_MIME_TYPES.has(normalizedMime);
    case "presentation":
      return PRESENTATION_MIME_TYPES.has(normalizedMime);
    case "spreadsheet":
      return SPREADSHEET_MIME_TYPES.has(normalizedMime);
  }
}

export function inferArtifactKind(descriptor: Pick<ArtifactDescriptor, "effectiveMimeType" | "filename">): LlmArtifactKind | undefined {
  const orderedKinds: readonly LlmArtifactKind[] = ["image", "audio", "pdf", "document", "presentation", "spreadsheet", "code", "text"];
  return orderedKinds.find((kind) => artifactKindSupportsMime(kind, descriptor.effectiveMimeType, descriptor.filename));
}

function artifactDetails(descriptor: ArtifactDescriptor): JsonValue {
  return {
    artifactId: descriptor.artifactId,
    blob: clone(descriptor.blob as unknown as JsonValue),
    effectiveMimeType: descriptor.effectiveMimeType,
    filename: descriptor.filename ?? null,
    source: descriptor.source ? clone(descriptor.source as unknown as JsonValue) : null,
  } as JsonValue;
}

export async function resolveArtifactsForRequest(input: {
  readonly request: Omit<LlmRequest, "requestId"> & { readonly requestId: string };
  readonly artifactStorage: ArtifactStorage | undefined;
}): Promise<ResolvedLlmRequest | ClassifiedError> {
  const { request, artifactStorage } = input;
  const artifactParts = request.input.messages.flatMap((message) => message.content).filter((part): part is Extract<typeof request.input.messages[number]["content"][number], { readonly kind: "artifact" }> => part.kind === "artifact");
  if (artifactParts.length === 0) {
    return { request, artifacts: [] };
  }
  if (!artifactStorage) {
    return classifiedError("modelCapability", "LLM_ARTIFACT_STORAGE_UNAVAILABLE", "Artifact storage is unavailable for provider request compilation.");
  }
  const resolvedArtifacts: ResolvedLlmArtifactPart[] = [];
  for (const part of artifactParts) {
    const artifact = await artifactStorage.getArtifact(part.ref);
    if (!artifact) {
      return classifiedError("artifactMissing", "LLM_ARTIFACT_MISSING", `Artifact '${part.ref.artifactId}' was not found.`, { ref: clone(part.ref as unknown as JsonValue) });
    }
    const exists = await artifactStorage.blobExists(artifact.blob);
    if (!exists) {
      return classifiedError("artifactMissing", "LLM_ARTIFACT_MISSING_BYTES", `Artifact '${part.ref.artifactId}' descriptor exists, but stored bytes were not found.`, { ref: clone(part.ref as unknown as JsonValue) });
    }
    const bytes = await artifactStorage.readBlob(artifact.blob);
    const explicitKind = part.mediaRole;
    if (explicitKind !== undefined && !artifactKindSupportsMime(explicitKind, artifact.effectiveMimeType, artifact.filename)) {
      return classifiedError("modelCapability", "LLM_ARTIFACT_MEDIA_ROLE_MISMATCH", `Artifact mediaRole '${explicitKind}' does not match MIME type '${artifact.effectiveMimeType}'.`, { artifact: artifactDetails(artifact), mediaRole: explicitKind });
    }
    const resolvedKind = explicitKind ?? inferArtifactKind(artifact);
    if (!resolvedKind) {
      return classifiedError("modelCapability", "LLM_ARTIFACT_KIND_UNRESOLVED", `Could not infer an artifact kind for MIME type '${artifact.effectiveMimeType}'.`, { artifact: artifactDetails(artifact) });
    }
    resolvedArtifacts.push({
      inputPart: part,
      artifact,
      bytes,
      kind: resolvedKind,
      effectiveMimeType: artifact.effectiveMimeType,
    });
  }
  return { request, artifacts: resolvedArtifacts };
}

export function validateResolvedArtifacts(input: {
  readonly request: ResolvedLlmRequest;
  readonly capabilities: LlmModelCapabilities;
  readonly supportedKinds: readonly LlmArtifactKind[];
  readonly requiredTransportByKind: Readonly<Partial<Record<LlmArtifactKind, string>>>;
}): ClassifiedError | undefined {
  const { request, capabilities, supportedKinds, requiredTransportByKind } = input;
  const totalBytes = request.artifacts.reduce((sum, artifact) => sum + artifact.artifact.blob.sizeBytes, 0);
  if (capabilities.input.maxTotalArtifactBytes !== undefined && totalBytes > capabilities.input.maxTotalArtifactBytes) {
    return classifiedError("modelCapability", "LLM_TOTAL_ARTIFACT_BYTES_EXCEEDED", `Total artifact bytes ${totalBytes} exceed model limit ${capabilities.input.maxTotalArtifactBytes}.`, { totalBytes, maxTotalArtifactBytes: capabilities.input.maxTotalArtifactBytes });
  }
  const counts = new Map<LlmArtifactKind, number>();
  for (const artifact of request.artifacts) {
    counts.set(artifact.kind, (counts.get(artifact.kind) ?? 0) + 1);
    if (!supportedKinds.includes(artifact.kind)) {
      return classifiedError("modelCapability", "LLM_ARTIFACT_KIND_UNSUPPORTED", `Provider protocol does not support artifact kind '${artifact.kind}'.`, { artifactId: artifact.artifact.artifactId, kind: artifact.kind });
    }
    const capability = capabilities.input.artifacts.find((entry) => entry.kind === artifact.kind);
    if (!capability) {
      return classifiedError("modelCapability", "LLM_ARTIFACT_INPUT_UNSUPPORTED", `Configured model does not support artifact kind '${artifact.kind}'.`, { artifactId: artifact.artifact.artifactId, kind: artifact.kind });
    }
    if (!isMimeAllowed(artifact.effectiveMimeType, capability.mimeTypes)) {
      return classifiedError("modelCapability", "LLM_ARTIFACT_MIME_UNSUPPORTED", `Configured model does not accept MIME type '${artifact.effectiveMimeType}'.`, { artifactId: artifact.artifact.artifactId, kind: artifact.kind, allowedMimeTypes: [...capability.mimeTypes] });
    }
    if (capability.maxBytes !== undefined && artifact.artifact.blob.sizeBytes > capability.maxBytes) {
      return classifiedError("modelCapability", "LLM_ARTIFACT_TOO_LARGE", `Artifact size ${artifact.artifact.blob.sizeBytes} exceeds model limit ${capability.maxBytes} bytes.`, { artifactId: artifact.artifact.artifactId, sizeBytes: artifact.artifact.blob.sizeBytes, maxBytes: capability.maxBytes });
    }
    const requiredTransport = requiredTransportByKind[artifact.kind];
    if (requiredTransport && !capability.transports.includes(requiredTransport as never)) {
      return classifiedError("modelCapability", "LLM_ARTIFACT_TRANSPORT_UNSUPPORTED", `Configured model does not expose required transport '${requiredTransport}' for artifact kind '${artifact.kind}'.`, { artifactId: artifact.artifact.artifactId, kind: artifact.kind, transports: [...capability.transports] });
    }
  }
  for (const [kind, count] of counts) {
    const capability = capabilities.input.artifacts.find((entry) => entry.kind === kind);
    if (capability?.maxCount !== undefined && count > capability.maxCount) {
      return classifiedError("modelCapability", "LLM_TOO_MANY_ARTIFACTS", `Request contains ${count} '${kind}' artifact inputs, exceeding maxCount=${capability.maxCount}.`, { kind, count, maxCount: capability.maxCount });
    }
  }
  return undefined;
}

export function capabilityForKind(capabilities: LlmModelCapabilities, kind: LlmArtifactKind): LlmArtifactInputCapability | undefined {
  return capabilities.input.artifacts.find((entry) => entry.kind === kind);
}

export function dataUrl(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}
function asObjectRecord(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, JsonValue>
    : undefined;
}

function hasExplicitPrimitiveType(record: Record<string, JsonValue>): boolean {
  return record.type === "string"
    || record.type === "number"
    || record.type === "integer"
    || record.type === "boolean"
    || record.type === "null";
}

function plannerIntentNextActionOpenAiSchema(): JsonValue {
  const topLevelProperties = {
    kind: {
      type: "string",
      enum: ["callTool", "askHuman", "notifyHuman", "awaitInput", "complete", "fail"],
    },
    toolId: { type: "string" },
    input: { type: "string" },
    rationaleSummary: { type: "string" },
    title: { type: "string" },
    body: { type: "string" },
    communicationKind: {
      type: "string",
      enum: ["showProgress", "showWarning", "showError", "showBlocked"],
    },
    result: { type: "string" },
    humanResult: {
      type: "object",
      additionalProperties: false,
      required: ["title", "body"],
      properties: {
        title: { type: "string" },
        body: { type: "string" },
      },
    },
    reason: { type: "string" },
    humanError: {
      type: "object",
      additionalProperties: false,
      required: ["title", "body", "communicationKind"],
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        communicationKind: {
          type: "string",
          enum: ["showError", "showBlocked"],
        },
      },
    },
  } as const;

  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(topLevelProperties),
    properties: topLevelProperties,
  } as JsonValue;
}

function toOpenAiCompatibleSchema(value: JsonValue | undefined): JsonValue | undefined {
  const record = asObjectRecord(value);
  if (!record) {
    return undefined;
  }
  if (hasExplicitPrimitiveType(record)) {
    return clone(record) as JsonValue;
  }
  if (Array.isArray(record.enum)) {
    const values = record.enum;
    if (values.every((entry) => typeof entry === "string")) {
      return { type: "string", enum: [...values] } as JsonValue;
    }
    if (values.every((entry) => typeof entry === "number")) {
      return { type: "number", enum: [...values] } as JsonValue;
    }
    if (values.every((entry) => typeof entry === "boolean")) {
      return { type: "boolean", enum: [...values] } as JsonValue;
    }
    return undefined;
  }
  if (typeof record.const === "string") {
    return { type: "string", enum: [record.const] } as JsonValue;
  }
  if (typeof record.const === "number") {
    return { type: "number", enum: [record.const] } as JsonValue;
  }
  if (typeof record.const === "boolean") {
    return { type: "boolean", enum: [record.const] } as JsonValue;
  }
  if (record.type === "array") {
    const items = toOpenAiCompatibleSchema(record.items as JsonValue | undefined);
    if (!items) {
      return undefined;
    }
    return {
      ...clone(record),
      type: "array",
      items,
    } as JsonValue;
  }
  if (record.type === "object") {
    const propertiesRecord = asObjectRecord(record.properties) ?? {};
    const normalizedProperties: Record<string, JsonValue> = {};
    for (const [key, propertySchema] of Object.entries(propertiesRecord)) {
      const normalized = toOpenAiCompatibleSchema(propertySchema);
      if (!normalized) {
        return undefined;
      }
      normalizedProperties[key] = normalized;
    }
    return {
      ...clone(record),
      type: "object",
      properties: normalizedProperties,
      additionalProperties: false,
      ...(Array.isArray(record.required) ? { required: record.required } : {}),
    } as JsonValue;
  }
  return undefined;
}
export function normalizeOpenAiStructuredOutputSchema(schema: JsonValue, options?: { readonly schemaId?: string }): JsonValue | undefined {
  if (options?.schemaId === "intent_next_action") {
    return plannerIntentNextActionOpenAiSchema();
  }
  const record = asObjectRecord(schema);
  if (!record) {
    return undefined;
  }
  return toOpenAiCompatibleSchema(record as JsonValue);

}
