import type { ActorContext, JsonValue } from "typed-actors";
import type { ArtifactStorage } from "../../../../artifacts/src/subsystem.ts";
import type { ClassifiedError, LlmResult } from "llm-contracts";
import type { SchemaRef } from "schema/domain";
import type {
  LlmRequestWorkerState,
} from "../llms/types.ts";
import { adapterForProtocol } from "../../providers/index.ts";
import {
  type LlmHttpClient,
} from "../../client.ts";
import { clone, classifiedError, toLlmResultError } from "../../support.ts";

export interface LlmProviderExecutionHelpers {
  mapClientError(requestId: string, error: unknown): LlmResult;
  workerComplete(ctx: ActorContext<any, any>, result: LlmResult): void;
  sendValidationRequest(ctx: ActorContext<any, any>, requestId: string, schemaRef: SchemaRef, value: JsonValue): void;
  resolveStructuredOutputSchema(schemaRef: SchemaRef): JsonValue | undefined;
}

export function invalidStructuredOutputDetails(content: string, cause: string): JsonValue {
  const preview = content
    .replace(/"(?:\\.|[^"\\])*"/gu, '"…"')
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 240);
  return {
    preview,
    cause,
  } as JsonValue;
}

export function extractSingleJsonDocument(content: string): JsonValue {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new Error("Response was empty.");
  }
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    return JSON.parse(trimmed) as JsonValue;
  }
  const fencedMatches = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/giu)];
  if (fencedMatches.length === 1) {
    const match = fencedMatches[0]!;
    if (match.index === 0 && match[0].length === trimmed.length) {
      const fencedContent = match[1];
      if (fencedContent === undefined) {
        throw new Error("Fenced JSON block did not contain content.");
      }
      return JSON.parse(fencedContent) as JsonValue;
    }
  }
  const recovered = extractBalancedJsonSubstring(trimmed);
  if (recovered !== undefined) {
    return JSON.parse(recovered) as JsonValue;
  }
  throw new Error("Expected exactly one raw JSON document or one fenced JSON block.");
}

function extractBalancedJsonSubstring(content: string): string | undefined {
  const candidates: string[] = [];
  for (let start = 0; start < content.length; start += 1) {
    const opener = content[start];
    if (opener !== "{" && opener !== "[") {
      continue;
    }
    const candidate = scanBalancedJson(content, start);
    if (candidate !== undefined) {
      candidates.push(candidate);
    }
  }
  if (candidates.length === 0) {
    return undefined;
  }
  const uniqueCandidates = [...new Set(candidates)];
  uniqueCandidates.sort((left, right) => right.length - left.length);
  for (const candidate of uniqueCandidates) {
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}

function scanBalancedJson(content: string, start: number): string | undefined {
  const stack: string[] = [];
  let inString = false;
  let escaping = false;
  for (let index = start; index < content.length; index += 1) {
    const char = content[index]!;
    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === "\\") {
        escaping = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push(char);
      continue;
    }
    if (char === "}" || char === "]") {
      const expected = char === "}" ? "{" : "[";
      if (stack[stack.length - 1] !== expected) {
        return undefined;
      }
      stack.pop();
      if (stack.length === 0) {
        return content.slice(start, index + 1);
      }
    }
  }
  return undefined;
}

function structuredOutputSchemaForState(
  state: LlmRequestWorkerState,
  helpers: Pick<LlmProviderExecutionHelpers, "resolveStructuredOutputSchema">,
): JsonValue | undefined {
  return state.request.responseSchema
    ? helpers.resolveStructuredOutputSchema(state.request.responseSchema)
    : undefined;
}

function revivePlannerStructuredOutput(value: JsonValue, schemaRef: SchemaRef | undefined): JsonValue {
  if (!schemaRef || schemaRef.schemaId !== "intent_next_action") {
    return value;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const record = clone(value as Record<string, JsonValue>);
  for (const key of ["input", "result"] as const) {
    const raw = record[key];
    if (typeof raw !== "string") continue;
    try {
      record[key] = JSON.parse(raw) as JsonValue;
    } catch {
      // Leave parsing failure to downstream schema/action validation.
    }
  }

  const kind = typeof record.kind === "string" ? record.kind : undefined;
  if (kind === undefined) {
    return record as JsonValue;
  }

  if (kind === "callTool" && typeof record.toolId === "string" && typeof record.input === "string") {
    if (record.toolId === "shell.execute") {
      record.input = { command: record.input } as JsonValue;
    } else {
      try {
        record.input = JSON.parse(record.input) as JsonValue;
      } catch {
        // Leave parsing failure to downstream validation.
      }
    }
  }

  const keepByKind: Record<string, readonly string[]> = {
    callTool: ["kind", "toolId", "input", "rationaleSummary"],
    askHuman: ["kind", "title", "body", "rationaleSummary"],
    notifyHuman: ["kind", "communicationKind", "title", "body", "rationaleSummary"],
    awaitInput: ["kind", "title", "body", "rationaleSummary"],
    complete: ["kind", "result", "humanResult", "rationaleSummary"],
    fail: ["kind", "reason", "humanError", "rationaleSummary"],
  };
  const keep = new Set(keepByKind[kind] ?? ["kind"]);
  for (const key of Object.keys(record)) {
    if (!keep.has(key)) {
      delete record[key];
    }
  }
  return record as JsonValue;
}

function toSuccessfulResult(
  state: LlmRequestWorkerState,
  content: string,
  usage?: JsonValue,
  model?: string,
  rawId?: string,
): LlmResult {
  return {
    type: "ok",
    requestId: state.requestId,
    output: [{ kind: "text", text: content }],
    usage: {
      providerId: state.providerId,
      providerTitle: state.providerTitle,
      model: model ?? state.modelId,
      rawId: rawId ?? null,
      usage: usage ?? null,
    } as JsonValue,
  };
}

function toStructuredOutputResult(
  state: LlmRequestWorkerState,
  content: string,
): LlmResult | { readonly validated: true; readonly parsed: JsonValue } {
  try {
    return { validated: true, parsed: revivePlannerStructuredOutput(extractSingleJsonDocument(content), state.request.responseSchema) };
  } catch (error) {
    return toLlmResultError(
      state.requestId,
      classifiedError(
        "outputInvalid",
        "LLM_OUTPUT_JSON_PARSE_FAILED",
        "Provider returned content that was not valid structured JSON.",
        invalidStructuredOutputDetails(content, error instanceof Error ? error.message : String(error)),
      ),
    );
  }
}

function missingStructuredOutputSchemaResult(state: LlmRequestWorkerState): LlmResult {
  return toLlmResultError(
    state.requestId,
    classifiedError(
      "schemaNotFound",
      "LLM_RESPONSE_SCHEMA_UNAVAILABLE",
      `Structured output schema '${state.request.responseSchema?.schemaId ?? "unknown"}' could not be resolved.`,
      state.request.responseSchema ? clone(state.request.responseSchema as unknown as JsonValue) : undefined,
    ),
  );
}

export async function processProviderRequest(
  ctx: ActorContext<any, any>,
  client: LlmHttpClient | undefined,
  authError: ClassifiedError | undefined,
  artifactStorage: ArtifactStorage | undefined,
  helpers: LlmProviderExecutionHelpers,
): Promise<void> {
  const state = ctx.state as LlmRequestWorkerState;
  if (!client) {
    helpers.workerComplete(
      ctx,
      toLlmResultError(
        state.requestId,
        authError ?? classifiedError("providerError", "LLM_PROVIDER_UNAVAILABLE", "Provider client is unavailable."),
      ),
    );
    return;
  }

  const adapter = adapterForProtocol(state.providerProtocol);
  const resolved = await adapter.resolveArtifacts({
    request: state.request,
    artifactStorage,
  });
  if ("category" in resolved) {
    helpers.workerComplete(ctx, toLlmResultError(state.requestId, resolved));
    return;
  }

  const validationError = adapter.validate({
    request: resolved,
    capabilities: state.capabilities,
  });
  if (validationError) {
    helpers.workerComplete(ctx, toLlmResultError(state.requestId, validationError));
    return;
  }

  const structuredOutputSchema = structuredOutputSchemaForState(state, helpers);
  if (state.request.responseSchema && structuredOutputSchema === undefined) {
    helpers.workerComplete(ctx, missingStructuredOutputSchemaResult(state));
    return;
  }

  try {
    const providerRequest = await adapter.compile({
      request: resolved,
      capabilities: state.capabilities,
      modelId: state.modelId,
      ...(structuredOutputSchema === undefined ? {} : { structuredOutputSchema }),
    });
    const execution = await adapter.execute({
      client,
      request: providerRequest,
    });
    if (!state.request.responseSchema) {
      helpers.workerComplete(
        ctx,
        toSuccessfulResult(state, execution.content, execution.usage, execution.model, execution.rawId),
      );
      return;
    }
    const structured = toStructuredOutputResult(state, execution.content);
    if ("validated" in structured) {
      helpers.sendValidationRequest(ctx, state.requestId, state.request.responseSchema!, structured.parsed);
      ctx.setState(clone({ ...state, awaiting: "schemaValidation", pendingStructuredOutput: clone(structured.parsed) }));
      return;
    }
    helpers.workerComplete(ctx, structured);
  } catch (error) {
    helpers.workerComplete(ctx, helpers.mapClientError(state.requestId, error));
  }
}
