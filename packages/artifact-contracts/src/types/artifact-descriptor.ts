import type { BlobRef } from "./blob-ref.ts";
import type { ArtifactSource } from "./artifact-source.ts";

export interface ArtifactDescriptor {
  readonly artifactId: string;
  readonly blob: BlobRef;
  readonly declaredMimeType?: string;
  readonly detectedMimeType?: string;
  readonly effectiveMimeType: string;
  readonly filename?: string;
  readonly source?: ArtifactSource;
  readonly createdAt: string;
}