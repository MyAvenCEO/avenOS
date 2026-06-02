import type { SchemaRef } from "./schema-ref.ts";
import type { SchemaResultRef } from "./schema-result-ref.ts";

export type SchemaValidationResult =
  | {
      readonly type: "ok";
      readonly schemaRef: SchemaRef;
      readonly schemaHash: string;
    }
  | {
      readonly type: "error";
      readonly schemaRef?: SchemaResultRef;
      readonly error: {
        readonly category: "schemaInvalid" | "schemaNotFound" | "invalidRequest";
        readonly code: string;
        readonly message: string;
        readonly details?: unknown;
      };
    };