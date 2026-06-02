import type { LlmCapabilityRequirements } from "llm-contracts";

export interface IntentRuntimeConfig {
  readonly planner?: {
    readonly requirements?: LlmCapabilityRequirements;
    readonly modelActorPathOverride?: string;
    readonly maxSteps?: number;
    readonly maxPromptChars?: number;
    readonly maxObservationChars?: number;
    readonly toolCatalogMode?: "compact" | "full";
    readonly includeFullSchemaOnValidationError?: boolean;
  };
  readonly toolDefaults?: {
    readonly structuredExtraction?: {
      readonly requirements?: LlmCapabilityRequirements;
      readonly modelActorPathOverride?: string;
    };
  };
  readonly tools?: {
    readonly maxRuns?: number;
    readonly artifactReadMaxBytes?: number;
    readonly shellInlinePreviewChars?: number;
  };
}