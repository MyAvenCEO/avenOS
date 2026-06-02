import type { SchemaRef } from "schema-contracts";
import type { ReplyAddress } from "shared";

export interface ListMetadataBySchemaMessage {
  readonly type: "listMetadataBySchema";
  readonly schemaRef: SchemaRef;
  readonly requestId?: string;
  readonly replyTo?: ReplyAddress;
}