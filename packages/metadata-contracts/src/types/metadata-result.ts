import type { JsonValue } from "typed-actors";
import type { MetadataRecord } from "./metadata-record.ts";

export type MetadataResult =
  | { readonly type: "ok"; readonly record: MetadataRecord }
  | {
      readonly type: "error";
      readonly error: {
        readonly category: "invalidRequest" | "schemaNotFound" | "schemaInvalid" | "artifactMissing" | "metadataInvalid" | "idempotencyConflict";
        readonly message: string;
        readonly details?: JsonValue;
      };
    };