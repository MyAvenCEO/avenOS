import type { ArtifactRef } from "artifact-contracts";

export type MetadataSubject =
  | { readonly type: "artifact"; readonly ref: ArtifactRef }
  | { readonly type: "intent"; readonly intentId: string }
  | { readonly type: "toolRun"; readonly toolRunId: string }
  | { readonly type: "llmRequest"; readonly requestId: string };