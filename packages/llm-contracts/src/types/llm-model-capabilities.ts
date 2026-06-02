import type { LlmArtifactInputCapability } from "./llm-artifact-input-capability.ts";
import type { LlmGeneralCapability } from "./llm-general-capability.ts";
import type { LlmInputModality } from "./llm-input-modality.ts";

export interface LlmModelCapabilities {
  readonly input: {
    readonly text: boolean;
    readonly json?: boolean;
    readonly artifacts: readonly LlmArtifactInputCapability[];
    readonly maxTotalArtifactBytes?: number;
  };
  readonly output: {
    readonly modalities: readonly LlmInputModality[];
  };
  readonly general: {
    readonly capabilities: readonly LlmGeneralCapability[];
  };
}