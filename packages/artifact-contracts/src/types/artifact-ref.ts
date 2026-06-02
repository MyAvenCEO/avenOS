import type { BlobRef } from "./blob-ref.ts";

export interface ArtifactRef {
  readonly artifactId: string;
  readonly blob: BlobRef;
}