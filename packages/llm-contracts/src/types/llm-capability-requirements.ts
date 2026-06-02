import type { LlmGeneralCapability } from "./llm-general-capability.ts";
import type { LlmInputModality } from "./llm-input-modality.ts";

export interface LlmCapabilityRequirements {
  readonly input?: {
    readonly modalities?: readonly LlmInputModality[];
  };
  readonly output?: {
    readonly modalities?: readonly LlmInputModality[];
  };
  readonly general?: {
    readonly requires?: readonly LlmGeneralCapability[];
  };
}