import type { ReplyableMessage } from "../../../actor-contracts/src/types/actor-message.ts";
import type { ArtifactRef } from "artifact-contracts";

export interface ListCompatibleReadersMessage extends ReplyableMessage<"listCompatibleReaders"> {
  readonly type: "listCompatibleReaders";
  readonly ref: ArtifactRef;
}