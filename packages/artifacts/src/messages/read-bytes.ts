import type { ReplyableMessage } from "../../../actor-contracts/src/types/actor-message.ts";
import type { ArtifactRef } from "artifact-contracts";

export interface ReadBytesMessage extends ReplyableMessage<"readBytes"> {
  readonly type: "readBytes";
  readonly ref: ArtifactRef;
  readonly offsetBytes: number;
  readonly lengthBytes: number;
}