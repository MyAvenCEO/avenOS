import type { JsonValue } from "typed-actors";
import type { MetadataQueryRecordsOutput } from "./metadata-query-records-output.ts";

export type MetadataQueryResult =
  | { readonly type: "ok"; readonly records: MetadataQueryRecordsOutput["records"]; readonly nextCursor?: string }
  | {
      readonly type: "error";
      readonly error: {
        readonly category: "invalidRequest" | "schemaNotFound" | "schemaInvalid" | "artifactMissing" | "metadataInvalid" | "idempotencyConflict";
        readonly message: string;
        readonly details?: JsonValue;
      };
    };