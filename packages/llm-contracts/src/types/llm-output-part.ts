import type { ArtifactRef } from "artifact-contracts";
import type { JsonValue } from "typed-actors";

export type LlmOutputPart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "json"; readonly value: JsonValue }
  | { readonly kind: "artifact"; readonly ref: ArtifactRef; readonly mediaRole?: string };