import type { MetadataSubject } from "../types/metadata-subject.ts";
import type { ReplyAddress } from "shared";

export interface ListMetadataBySubjectMessage {
  readonly type: "listMetadataBySubject";
  readonly subject: MetadataSubject;
  readonly requestId?: string;
  readonly replyTo?: ReplyAddress;
}