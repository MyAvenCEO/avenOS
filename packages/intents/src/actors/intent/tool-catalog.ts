import { ActorId, type ActorContext, type JsonValue } from "typed-actors";
import type {
  ArtifactReadBytesRequest,
  ArtifactGetDescriptorRequest,
  ArtifactRef,
} from "artifact-contracts";
import type { ShellExecuteRequest } from "../../../../shell-contracts/src/index.ts";
import type {
  GetSchemaVersionRequest,
  ValidateJsonRequest,
} from "schema-contracts";
import type { SchemaRef } from "schema-contracts";
import { toReplyAddress } from "shared";
import { createSchemaValidationService } from "schema";
import type { AvenRegistry } from "../../../../runtime/src/spine.ts";
import type { IntentActorState, IntentToolDefinition, IntentToolRunState, PreparedToolInputResult } from "./types.ts";

const validationService = createSchemaValidationService();

type ToolExecutionContext = ActorContext<AvenRegistry, never>;

export interface IntentToolCatalogHelpers {
  readonly IntentToolRunKind: string;
  clone<T>(value: T): T;
  sanitizeJson(value: JsonValue): JsonValue;
  bounded(value: JsonValue): JsonValue;
}

function metadataSubjectSchema(): JsonValue {
  return {
    oneOf: [
      {
        type: "object",
        required: ["type", "ref"],
        additionalProperties: false,
        properties: {
          type: { const: "artifact" },
          ref: artifactRefSchema(),
        },
      },
      {
        type: "object",
        required: ["type", "intentId"],
        additionalProperties: false,
        properties: {
          type: { const: "intent" }, intentId: { type: "string" } } },
      { type: "object", required: ["type", "toolRunId"], additionalProperties: false, properties: { type: { const: "toolRun" }, toolRunId: { type: "string" } } },
      { type: "object", required: ["type", "requestId"], additionalProperties: false, properties: { type: { const: "llmRequest" }, requestId: { type: "string" } } },
    ],
  } as JsonValue;
}

function metadataQueryInputSchema(): JsonValue {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      schemaId: { type: "string" },
      schemaVersion: { type: "string" },
      subjectType: { enum: ["artifact", "intent", "toolRun", "llmRequest"] },
      subjectId: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 200 },
    },
  } as JsonValue;
}

function isRecord(value: JsonValue | undefined | null): value is Record<string, JsonValue> {
  return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value);
}

function preparedToolInputError(message: string, details?: JsonValue): PreparedToolInputResult {
  return { type: "error", message, ...(details === undefined ? {} : { details }) };
}

function prepareMetadataQueryInput(input: JsonValue, intentState: IntentActorState, helpers: Pick<IntentToolCatalogHelpers, "clone">): PreparedToolInputResult {
  if (!isRecord(input)) {
    return preparedToolInputError("metadata.queryRecords input must be an object.");
  }
  const schemaId = typeof input.schemaId === "string" ? input.schemaId : undefined;
  const schemaVersion = typeof input.schemaVersion === "string" ? input.schemaVersion : undefined;
  const subjectType = typeof input.subjectType === "string" ? input.subjectType : undefined;
  const subjectId = typeof input.subjectId === "string" ? input.subjectId : undefined;
  const limit = typeof input.limit === "number" ? input.limit : undefined;
  let subject: JsonValue | undefined;
  if (subjectType !== undefined) {
    if (!subjectId) {
      return preparedToolInputError("metadata.queryRecords requires subjectId when subjectType is provided.");
    }
    if (subjectType === "artifact") {
      const sourceInput = isRecord(intentState.input) ? intentState.input : undefined;
      const attachments = Array.isArray(sourceInput?.attachments) ? sourceInput.attachments : [];
      const attachment = attachments.find((entry) => {
        if (!isRecord(entry)) return false;
        const ref = isRecord(entry.ref) ? entry.ref : undefined;
        return typeof ref?.artifactId === "string" && ref.artifactId === subjectId;
      });
      const ref = attachment && isRecord(attachment) && isRecord(attachment.ref) ? attachment.ref : undefined;
      if (!ref || typeof ref.artifactId !== "string" || !isRecord(ref.blob)) {
        return preparedToolInputError(`Artifact '${subjectId}' is not available as a full ArtifactRef in this intent.`, helpers.clone(input));
      }
      subject = { type: "artifact", ref: helpers.clone(ref as JsonValue) } as JsonValue;
    } else if (subjectType === "intent") {
      subject = { type: "intent", intentId: subjectId } as JsonValue;
    } else if (subjectType === "toolRun") {
      subject = { type: "toolRun", toolRunId: subjectId } as JsonValue;
    } else if (subjectType === "llmRequest") {
      subject = { type: "llmRequest", requestId: subjectId } as JsonValue;
    } else {
      return preparedToolInputError(`Unsupported subjectType '${subjectType}'.`);
    }
  }
  return {
    type: "ok",
    input: {
      ...(schemaId === undefined ? {} : { schemaId }),
      ...(schemaVersion === undefined ? {} : { version: schemaVersion }),
      ...(subject === undefined ? {} : { subject }),
      ...(limit === undefined ? {} : { limit }),
    } as JsonValue,
  };
}

function prepareStructuredExtractionInput(input: JsonValue, intentState: IntentActorState, helpers: Pick<IntentToolCatalogHelpers, "clone">): PreparedToolInputResult {
  if (!isRecord(input)) {
    return preparedToolInputError("structuredExtraction.extract input must be an object.");
  }
  const artifactId = typeof input.artifactId === "string" ? input.artifactId : undefined;
  const schemaId = typeof input.schemaId === "string" ? input.schemaId : undefined;
  if (!artifactId || !schemaId) {
    return preparedToolInputError("structuredExtraction.extract requires artifactId and schemaId.");
  }
  if ("artifact" in input || "schema" in input || "version" in input || "schemaRef" in input || "mediaRole" in input) {
    return preparedToolInputError("structuredExtraction.extract accepts only artifactId, schemaId, and optional instruction.", helpers.clone(input));
  }
  const sourceInput = isRecord(intentState.input) ? intentState.input : undefined;
  const attachments = Array.isArray(sourceInput?.attachments) ? sourceInput.attachments : [];
  const scopeArtifacts = attachments.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const ref = isRecord(entry.ref) ? entry.ref : undefined;
    if (!ref || typeof ref.artifactId !== "string" || !isRecord(ref.blob)) {
      return [];
    }
    return [{
      artifactId: ref.artifactId,
      ref: helpers.clone(ref as JsonValue),
      ...(typeof entry.filename === "string" ? { filename: entry.filename } : {}),
      ...(typeof entry.declaredMimeType === "string" ? { declaredMimeType: entry.declaredMimeType } : {}),
      ...(typeof entry.effectiveMimeType === "string" ? { effectiveMimeType: entry.effectiveMimeType } : {}),
      ...(typeof entry.mediaRole === "string" ? { mediaRole: entry.mediaRole } : {}),
    }];
  });
  if (!scopeArtifacts.some((entry) => entry.artifactId === artifactId)) {
    return preparedToolInputError(`Artifact '${artifactId}' is not available in the current intent scope.`, helpers.clone(input));
  }
  return {
    type: "ok",
    input: {
      artifactId,
      schemaId,
      ...(typeof input.instruction === "string" ? { instruction: input.instruction } : {}),
      scope: {
        intentId: intentState.intentId,
        artifacts: scopeArtifacts,
      },
    } as JsonValue,
  };
}

function blobRefSchema(): JsonValue {
  return {
    type: "object",
    required: ["algorithm", "hash", "sizeBytes"],
    additionalProperties: false,
    properties: {
      algorithm: { const: "sha256" },
      hash: { type: "string" },
      sizeBytes: { type: "integer", minimum: 0 },
    },
  } as JsonValue;
}

function artifactRefSchema(): JsonValue {
  return {
    type: "object",
    required: ["artifactId", "blob"],
    additionalProperties: false,
    properties: {
      artifactId: { type: "string" },
      blob: blobRefSchema(),
    },
  } as JsonValue;
}

function normalizeMetadataQueryResult(helpers: IntentToolCatalogHelpers, result: JsonValue): JsonValue {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return helpers.sanitizeJson(result);
  }
  const value = result as Record<string, JsonValue>;
  if (value.type !== "ok" || !Array.isArray(value.records)) {
    return helpers.sanitizeJson(result);
  }
  return {
    type: "ok",
    records: value.records.map((entry) => {
      const record = entry as Record<string, JsonValue>;
      return {
        recordId: record.recordId,
        schema: record.schema,
        subject: record.subject,
        value: helpers.bounded(helpers.sanitizeJson(record.value as JsonValue)),
        createdAt: record.createdAt,
        ...(record.updatedAt === undefined ? {} : { updatedAt: record.updatedAt }),
      } as JsonValue;
    }),
    ...(value.nextCursor === undefined ? {} : { nextCursor: value.nextCursor }),
  } as JsonValue;
}

function normalizeMetadataRecordResult(helpers: IntentToolCatalogHelpers, result: JsonValue): JsonValue {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return helpers.sanitizeJson(result);
  }
  const value = result as Record<string, JsonValue>;
  if (value.type !== "ok" || !value.record || typeof value.record !== "object" || Array.isArray(value.record)) {
    return helpers.sanitizeJson(result);
  }
  const record = value.record as Record<string, JsonValue>;
  return {
    type: "ok",
    record: {
      recordId: record.recordId,
        schema: record.schema,
        subject: record.subject,
      createdAt: record.createdAt,
      ...(record.updatedAt === undefined ? {} : { updatedAt: record.updatedAt }),
    },
  } as JsonValue;
}

export function listIntentToolCatalog(helpers: IntentToolCatalogHelpers): readonly IntentToolDefinition[] {
  return [
    {
      toolId: "shell.execute",
      title: "Shell",
      description: "Execute a shell command on Linux using /bin/sh and return stdout/stderr. Use POSIX shell syntax and POSIX-style paths. Output is truncated inline; use intent.readArtifact with returned ArtifactRefs to page through full results.",
      inputSchema: {
        type: "object",
        required: ["command"],
        additionalProperties: false,
        properties: {
          command: { type: "string", description: "Shell command line passed to /bin/sh -c." },
          timeoutSeconds: { type: "integer", minimum: 1 },
          cwd: { type: "string" },
          stdinText: { type: "string" },
        },
      } as JsonValue,
      outputDescription: "Returns exitCode, bounded stdout/stderr previews, truncation flags, optional stdout/stderr artifact refs, durationMs, and timedOut.",
      mutates: true,
      available: true,
      summarizeObservation: helpers.sanitizeJson,
      execute(ctx: ToolExecutionContext, state: IntentToolRunState) {
        const input = helpers.clone(state.input) as unknown as { readonly command: string; readonly timeoutSeconds?: number; readonly cwd?: string; readonly stdinText?: string };
        const request: ShellExecuteRequest = {
          type: "shellExecuteRequest",
          requestId: state.runId,
          replyTo: toReplyAddress(ctx.self.id, helpers.IntentToolRunKind),
          command: input.command,
          ...(input.timeoutSeconds === undefined ? {} : { timeoutSeconds: input.timeoutSeconds }),
          ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
          ...(input.stdinText === undefined ? {} : { stdinText: input.stdinText }),
        };
        ctx.send({ id: ActorId.parse("/aven/system/shell"), kind: "shell" as never }, request as never);
      },
    },
    {
      toolId: "intent.readArtifact",
      title: "Read artifact",
      description: "Read a chunk of an artifact by ArtifactRef. Returns at most 4 KB per call. Use offsetBytes to page through larger artifacts.",
      inputSchema: {
        type: "object",
        required: ["artifact", "offsetBytes", "lengthBytes"],
        additionalProperties: false,
        properties: {
          artifact: artifactRefSchema(),
          offsetBytes: { type: "integer", minimum: 0 },
          lengthBytes: { type: "integer", minimum: 1 },
          mode: { enum: ["bytes", "text"], default: "text" },
        },
      } as JsonValue,
      outputDescription: "Returns { inner, clamped? } where inner contains either decoded text or base64 bytes with bounded length.",
      mutates: false,
      available: true,
      summarizeObservation: helpers.sanitizeJson,
      execute(ctx: ToolExecutionContext, state: IntentToolRunState) {
        const input = helpers.clone(state.input) as unknown as { readonly artifact: ArtifactRef; readonly offsetBytes: number; readonly lengthBytes: number; readonly mode?: "bytes" | "text" };
        const request: ArtifactReadBytesRequest = {
          type: "artifactReadBytesRequest",
          requestId: state.runId,
          replyTo: toReplyAddress(ctx.self.id, helpers.IntentToolRunKind),
          ref: helpers.clone(input.artifact),
          offsetBytes: input.offsetBytes,
          lengthBytes: Math.min(input.lengthBytes, state.artifactReadMaxBytes),
        };
        ctx.send({ id: ActorId.parse("/aven/system/artifacts"), kind: "artifacts" as never }, request as never);
      },
    },
    {
      toolId: "metadata.queryRecords",
      title: "Query metadata records",
      description: "Query existing metadata records using bounded filters over stored JSON values.",
      inputSchema: metadataQueryInputSchema(),
      outputDescription: "Returns { records, nextCursor } with normalized record entries.",
      mutates: false,
      available: true,
      summarizeObservation: (result) => normalizeMetadataQueryResult(helpers, result),
      prepareInput: ({ input, intentState }) => prepareMetadataQueryInput(input, intentState, helpers),
      execute(ctx: ToolExecutionContext, state: IntentToolRunState) {
        ctx.send({ id: ActorId.parse("/aven/system/metadata"), kind: "metadata" as never }, {
          type: "queryMetadataRecords",
          requestId: state.runId,
          replyTo: toReplyAddress(ctx.self.id, helpers.IntentToolRunKind),
          query: helpers.clone(state.input),
        } as never);
      },
    },
    {
      toolId: "metadata.createRecord",
      title: "Create metadata record",
      description: "Create a validated metadata record for a subject and schema version.",
      inputSchema: {
        type: "object",
        required: ["subject", "schemaRef", "value"],
        additionalProperties: false,
        properties: {
          subject: metadataSubjectSchema(),
          schemaRef: {
            type: "object",
            required: ["schemaId", "version"],
            additionalProperties: false,
            properties: { schemaId: { type: "string" }, version: { type: "string" } },
          },
          value: {},
          idempotencyKey: { type: "string" },
          previousRecordId: { type: "string" },
        },
      } as JsonValue,
      outputDescription: "Returns a created record summary with recordId and schemaRef.",
      mutates: true,
      available: true,
      summarizeObservation: (result) => normalizeMetadataRecordResult(helpers, result),
      execute(ctx: ToolExecutionContext, state: IntentToolRunState) {
        ctx.send({ id: ActorId.parse("/aven/system/metadata"), kind: "metadata" as never }, {
          type: "createMetadataRecord",
          requestId: state.runId,
          replyTo: toReplyAddress(ctx.self.id, helpers.IntentToolRunKind),
          ...(helpers.clone(state.input as Record<string, JsonValue>) as object),
        } as never);
      },
    },
    {
      toolId: "metadata.getRecord",
      title: "Get metadata record",
      description: "Get one metadata record by recordId.",
      inputSchema: { type: "object", required: ["recordId"], additionalProperties: false, properties: { recordId: { type: "string" } } } as JsonValue,
      outputDescription: "Returns one record summary or a typed error.",
      mutates: false,
      available: true,
      summarizeObservation: (result) => normalizeMetadataRecordResult(helpers, result),
      execute(ctx: ToolExecutionContext, state: IntentToolRunState) {
        ctx.send({ id: ActorId.parse("/aven/system/metadata"), kind: "metadata" as never }, {
          type: "getMetadataRecord",
          requestId: state.runId,
          replyTo: toReplyAddress(ctx.self.id, helpers.IntentToolRunKind),
          ...(helpers.clone(state.input as Record<string, JsonValue>) as object),
        } as never);
      },
    },
    {
      toolId: "structuredExtraction.extract",
      title: "Extract structured data from an artifact",
      description: "Extract structured JSON from one available artifact using one available extraction schema. Use this for invoices, account statements, delivery slips, travel tickets, calendar documents, and notes.",
      inputSchema: {
        type: "object",
        required: ["artifactId", "schemaId"],
        additionalProperties: false,
        properties: {
          artifactId: {
            type: "string",
            description: "Choose exactly one artifactId from availableArtifacts. Do not include blob, ref, MIME, mediaRole, or file bytes.",
          },
          schemaId: {
            enum: ["invoice", "bank_statement", "calendar_event", "shipping_delivery", "travel_ticket", "note"],
            description: "Choose exactly one schemaId from availableExtractionSchemas. Do not include a version or schema object.",
          },
          instruction: { type: "string", description: "Optional short instruction for extraction. Do not paste a schema here." },
        },
      } as JsonValue,
      outputDescription: "Returns validated structured JSON and persists it as metadata on the artifact.",
      mutates: true,
      available: true,
      summarizeObservation: helpers.sanitizeJson,
      prepareInput: ({ input, intentState }) => prepareStructuredExtractionInput(input, intentState, helpers),
      execute(ctx: ToolExecutionContext, state: IntentToolRunState) {
        const input = helpers.clone(state.input) as Record<string, JsonValue>;
        ctx.send({ id: ActorId.parse("/aven/system/structured-extraction"), kind: "structuredExtraction" as never }, {
          type: "structuredExtractionRequest",
          requestId: state.runId,
          replyTo: toReplyAddress(ctx.self.id, helpers.IntentToolRunKind),
          artifactId: input.artifactId as string,
          schemaId: input.schemaId as string,
          ...(typeof input.instruction === "string" ? { instruction: input.instruction } : {}),
          scope: input.scope,
          requirements: state.structuredExtractionRequirements,
        } as never);
      },
    },
    {
      toolId: "artifact.getDescriptor",
      title: "Get artifact descriptor",
      description: "Get safe descriptor metadata for an artifact reference.",
      inputSchema: {
        type: "object",
        required: ["artifact"],
        additionalProperties: false,
        properties: {
          artifact: artifactRefSchema(),
        },
      } as JsonValue,
      outputDescription: "Returns artifact descriptor metadata without bytes.",
      mutates: false,
      available: true,
      summarizeObservation: helpers.sanitizeJson,
      execute(ctx: ToolExecutionContext, state: IntentToolRunState) {
        const input = helpers.clone(state.input) as unknown as { readonly artifact: ArtifactRef };
        const request: ArtifactGetDescriptorRequest = {
          type: "artifactGetDescriptorRequest",
          requestId: state.runId,
          ref: helpers.clone(input.artifact),
          replyTo: toReplyAddress(ctx.self.id, helpers.IntentToolRunKind),
        };
        ctx.send({ id: ActorId.parse("/aven/system/artifacts"), kind: "artifacts" as never }, request as never);
      },
    },
    {
      toolId: "schema.get",
      title: "Get schema version",
      description: "Fetch one pinned schema version document. Version 'latest' is unsupported for this tool.",
      inputSchema: {
        type: "object",
        required: ["schemaId", "version"],
        additionalProperties: false,
        properties: { schemaId: { type: "string" }, version: { type: "string" } },
      } as JsonValue,
      outputDescription: "Returns schemaRef and schema hash with a bounded schema preview.",
      mutates: false,
      available: true,
      summarizeObservation: (result) => {
        if (!result || typeof result !== "object" || Array.isArray(result)) {
          return helpers.sanitizeJson(result);
        }
        const value = result as Record<string, JsonValue>;
        if (value.type !== "ok") {
          return helpers.sanitizeJson(result);
        }
        return {
          type: "ok",
          schemaRef: value.schemaRef,
          schemaHash: value.schemaHash,
          schemaPreview: helpers.bounded(value.schema as JsonValue),
        } as JsonValue;
      },
      execute(ctx: ToolExecutionContext, state: IntentToolRunState) {
        const input = helpers.clone(state.input) as { readonly schemaId: string; readonly version: string };
        const request: GetSchemaVersionRequest = {
          type: "getSchemaVersionRequest",
          requestId: state.runId,
          schemaRef: { schemaId: input.schemaId, version: input.version },
          replyTo: toReplyAddress(ctx.self.id, helpers.IntentToolRunKind),
        };
        ctx.send({ id: ActorId.parse("/aven/system/schemas"), kind: "schemaRegistry" as never }, request as never);
      },
    },
    {
      toolId: "schema.validateJson",
      title: "Validate JSON against schema",
      description: "Validate a JSON value against one pinned schema version.",
      inputSchema: {
        type: "object",
        required: ["schemaRef", "value"],
        additionalProperties: false,
        properties: {
          schemaRef: {
            type: "object",
            required: ["schemaId", "version"],
            additionalProperties: false,
            properties: { schemaId: { type: "string" }, version: { type: "string" } },
          },
          value: {},
        },
      } as JsonValue,
      outputDescription: "Returns validation ok/error for the provided JSON.",
      mutates: false,
      available: true,
      summarizeObservation: helpers.sanitizeJson,
      execute(ctx: ToolExecutionContext, state: IntentToolRunState) {
        const input = helpers.clone(state.input) as unknown as { readonly schemaRef: SchemaRef; readonly value: JsonValue };
        const request: ValidateJsonRequest = {
          type: "validateJsonRequest",
          requestId: state.runId,
          schemaRef: helpers.clone(input.schemaRef),
          value: helpers.clone(input.value),
          replyTo: toReplyAddress(ctx.self.id, helpers.IntentToolRunKind),
        };
        ctx.send({ id: ActorId.parse("/aven/system/schemas"), kind: "schemaRegistry" as never }, request as never);
      },
    },
    {
      toolId: "human.ask",
      title: "Ask human",
      description: "Unsupported in Intent v1 planner tool catalog; use planner askHuman action instead.",
      inputSchema: { type: "object", additionalProperties: true } as JsonValue,
      outputDescription: "Unavailable.",
      mutates: false,
      available: false,
      unavailableReason: "Unsupported. The planner must use the askHuman action, not a tool call.",
      summarizeObservation: helpers.sanitizeJson,
    },
  ] as const;
}

export function validateToolInput(tool: IntentToolDefinition, input: JsonValue): readonly string[] {
  return validationService.validateAdhocValue(tool.inputSchema, input);
}

export function normalizeIntentToolInput(tool: IntentToolDefinition, input: JsonValue): JsonValue {
  return input;
}

export function prepareIntentToolInput(tool: IntentToolDefinition, input: JsonValue, intentState: IntentActorState): PreparedToolInputResult {
  if (!tool.prepareInput) {
    return { type: "ok", input };
  }
  return tool.prepareInput({ input, intentState, helpers: { clone: structuredClone } });
}

export function completeToolRunResult(
  toolCatalogById: ReadonlyMap<string, IntentToolDefinition>,
  state: IntentToolRunState,
  result: JsonValue,
  sanitizeJson: (value: JsonValue) => JsonValue,
): JsonValue {
  const tool = toolCatalogById.get(state.toolId);
  return tool ? tool.summarizeObservation(result) : sanitizeJson(result);
}
