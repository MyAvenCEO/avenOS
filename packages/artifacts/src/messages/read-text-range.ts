import type { ReplyableMessage } from "../../../actor-contracts/src/types/actor-message.ts";
import type { ArtifactRef } from "artifact-contracts";

export interface ReadTextRangeMessage extends ReplyableMessage<"readTextRange"> {
  readonly type: "readTextRange";
  readonly ref: ArtifactRef;
  readonly offsetBytes: number;
  readonly lengthBytes: number;
}