import type { ArtifactRef } from "artifact-contracts";
import type { JsonValue } from "typed-actors";
import type { LlmArtifactKind } from "./llm-artifact-kind.ts";

export type LlmInputPart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "json"; readonly value: JsonValue }
  | { readonly kind: "artifact"; readonly ref: ArtifactRef; readonly mediaRole?: LlmArtifactKind };