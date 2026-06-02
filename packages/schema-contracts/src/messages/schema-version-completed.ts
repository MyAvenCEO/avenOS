import type { SchemaRef } from "../types/schema-ref.ts";
import type { SchemaValidationResult } from "../types/schema-validation-result.ts";

export interface SchemaVersionCompleted {
  readonly type: "schemaVersionCompleted";
  readonly requestId: string;
  readonly result:
    | {
        readonly type: "ok";
        readonly schemaRef: SchemaRef;
        readonly schemaHash: string;
        readonly schema: unknown;
      }
    | Extract<SchemaValidationResult, { readonly type: "error" }>;
}