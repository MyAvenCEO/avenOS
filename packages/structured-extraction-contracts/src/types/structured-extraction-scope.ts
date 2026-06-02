import type { ArtifactRef } from "artifact-contracts";

export interface StructuredExtractionScopeArtifact {
  readonly artifactId: string;
  readonly ref: ArtifactRef;
  readonly filename?: string;
  readonly declaredMimeType?: string;
  readonly effectiveMimeType?: string;
  readonly mediaRole?: string;
}

export interface StructuredExtractionScope {
  readonly intentId: string;
  readonly artifacts: readonly StructuredExtractionScopeArtifact[];
}