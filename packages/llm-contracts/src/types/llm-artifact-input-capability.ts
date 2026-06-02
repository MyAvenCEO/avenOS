import type { LlmArtifactKind } from "./llm-artifact-kind.ts";
import type { LlmArtifactTransport } from "./llm-artifact-transport.ts";

export interface LlmArtifactInputCapability {
  readonly kind: LlmArtifactKind;
  readonly mimeTypes: readonly string[];
  readonly transports: readonly LlmArtifactTransport[];
  readonly maxBytes?: number;
  readonly maxCount?: number;
}