import type { ArtifactRef } from "artifact-contracts";
import type { ClassifiedError } from "llm-contracts";
import type { SchemaRef } from "schema-contracts";
import type { JsonValue } from "typed-actors";

export type StructuredExtractionResult =
  | {
      readonly type: "ok";
      readonly artifact: ArtifactRef;
      readonly schemaRef: SchemaRef;
      readonly value: JsonValue;
      readonly metadataRecordId: string;
    }
  | {
      readonly type: "error";
      readonly error: ClassifiedError;
    };