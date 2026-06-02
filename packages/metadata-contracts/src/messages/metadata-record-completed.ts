import type { MetadataResult } from "../types/metadata-result.ts";

export interface MetadataRecordCompleted {
  readonly type: "metadataRecordCompleted";
  readonly requestId: string;
  readonly result: MetadataResult;
}