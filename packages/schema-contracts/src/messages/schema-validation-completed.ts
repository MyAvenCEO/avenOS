import type { SchemaValidationResult } from "../types/schema-validation-result.ts";

export interface SchemaValidationCompleted {
  readonly type: "schemaValidationCompleted";
  readonly requestId: string;
  readonly result: SchemaValidationResult;
}