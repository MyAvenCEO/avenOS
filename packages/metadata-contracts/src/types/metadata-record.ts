import type { JsonValue } from "typed-actors";
import type { SchemaRef } from "schema-contracts";
import type { MetadataSubject } from "./metadata-subject.ts";

export interface MetadataRecord {
  readonly recordId: string;
  readonly subject: MetadataSubject;
  readonly schemaRef: SchemaRef;
  readonly schemaHash: string;
  readonly value: JsonValue;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly previousRecordId?: string;
  readonly idempotencyKey?: string;
  readonly updatedAt?: string;
}