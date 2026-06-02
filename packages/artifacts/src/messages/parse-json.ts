import type { ReplyableMessage } from "../../../actor-contracts/src/types/actor-message.ts";
import type { ArtifactRef } from "artifact-contracts";

export interface ParseJsonMessage extends ReplyableMessage<"parseJson"> {
  readonly type: "parseJson";
  readonly ref: ArtifactRef;
}