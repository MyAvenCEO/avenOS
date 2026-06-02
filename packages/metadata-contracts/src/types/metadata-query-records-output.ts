import type { JsonValue } from "typed-actors";
import type { SchemaRef } from "schema-contracts";
import type { MetadataSubject } from "./metadata-subject.ts";

export interface MetadataQueryRecordsOutput {
  readonly records: ReadonlyArray<{
    readonly recordId: string;
    readonly schema: SchemaRef;
    readonly subject: MetadataSubject;
    readonly value: JsonValue;
    readonly createdAt: string;
    readonly updatedAt?: string;
  }>;
  readonly nextCursor?: string;
}