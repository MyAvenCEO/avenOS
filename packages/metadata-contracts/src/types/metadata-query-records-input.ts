import type { MetadataQueryFilter } from "./metadata-query-filter.ts";
import type { MetadataSubject } from "./metadata-subject.ts";

export interface MetadataQueryRecordsInput {
  readonly schemaId?: string;
  readonly version?: string | "latest";
  readonly subject: MetadataSubject | undefined;
  readonly limit?: number;
  readonly cursor?: string;
  readonly filters?: readonly MetadataQueryFilter[];
}