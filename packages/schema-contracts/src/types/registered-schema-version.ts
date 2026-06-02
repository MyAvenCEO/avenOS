import type { SchemaRef } from "./schema-ref.ts";

export interface RegisteredSchemaVersion {
  readonly schemaRef: SchemaRef;
  readonly schemaHash: string;
  readonly schema: unknown;
  readonly registeredAt: string;
}