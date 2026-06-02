import { buildActorRuntime, defineActorShape, field, msg, type DerivedActorRuntime } from "typed-actors";
import type { LlmResult } from "llm-contracts";
import type { MetadataResult } from "metadata-contracts";
import type { ExtractStructuredRequest } from "structured-extraction-contracts";
import type { PendingMetadataWrite, PendingStructuredExtraction, StructuredExtractionActorState } from "./actor.ts";

export const structuredExtractionActorShape = defineActorShape({
  kind: "structuredExtraction",
  state: {
    pendingByLlmRequestId: field.ref<Record<string, PendingStructuredExtraction>>({ default: {} as Record<string, PendingStructuredExtraction> }),
    pendingByMetadataRequestId: field.ref<Record<string, PendingMetadataWrite>>({ default: {} as Record<string, PendingMetadataWrite> }),
  },
  messages: {
    structuredExtractionRequest: msg({
      requestId: field.string({ optional: true }),
      replyTo: field.ref<{ readonly actorId: string; readonly actorKind: string }>({ optional: true }),
      artifactId: field.string(),
      schemaId: field.string(),
      instruction: field.string({ optional: true }),
      scope: field.ref<ExtractStructuredRequest["scope"]>(),
      requirements: field.ref<ExtractStructuredRequest["requirements"]>({ optional: true }),
    }),
    llmRequestCompleted: msg({
      requestId: field.string(),
      result: field.ref<LlmResult>(),
    }),
    metadataRecordCompleted: msg({
      requestId: field.string(),
      result: field.ref<MetadataResult>(),
    }),
  },
  present(state) {
    return {
      title: "structured extraction",
      subtitle: `${Object.keys(state.pendingByLlmRequestId).length} llm / ${Object.keys(state.pendingByMetadataRequestId).length} metadata pending`,
    };
  },
});

export const structuredExtractionActorRuntime = buildActorRuntime(structuredExtractionActorShape) as DerivedActorRuntime<
  typeof structuredExtractionActorShape.messages,
  StructuredExtractionActorState
>;