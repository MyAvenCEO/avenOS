import type { MetadataQueryResult } from "../types/metadata-query-result.ts";

export interface MetadataQueryCompleted {
  readonly type: "metadataQueryCompleted";
  readonly requestId: string;
  readonly result: MetadataQueryResult;
}