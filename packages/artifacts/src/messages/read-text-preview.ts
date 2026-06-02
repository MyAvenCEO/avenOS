import type { ReplyableMessage } from "../../../actor-contracts/src/types/actor-message.ts";
import type { ArtifactRef } from "artifact-contracts";

export interface ReadTextPreviewMessage extends ReplyableMessage<"readTextPreview"> {
  readonly type: "readTextPreview";
  readonly ref: ArtifactRef;
  readonly maxChars: number;
}