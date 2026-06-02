import type { SchemaValidationResult } from "schema-contracts";

export interface LlmValidationCompleted {
  readonly type: "llmValidationCompleted";
  readonly requestId: string;
  readonly result: SchemaValidationResult;
}