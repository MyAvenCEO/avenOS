import type { BlobRef } from "./blob-ref.ts";

export interface BlobDescriptor {
  readonly ref: BlobRef;
  readonly detectedMimeType?: string;
  readonly effectiveMimeType: string;
  readonly createdAt: string;
}