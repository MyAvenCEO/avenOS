import type { StructuredExtractionResult } from "../types/structured-extraction-result.ts";

export interface ExtractStructuredCompleted {
  readonly type: "structuredExtractionCompleted";
  readonly requestId: string;
  readonly result: StructuredExtractionResult;
}