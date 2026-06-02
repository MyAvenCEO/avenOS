import type { ReplyableMessage } from "../../../actor-contracts/src/types/actor-message.ts";
import type { ArtifactRef } from "../types/artifact-ref.ts";

export interface ArtifactExistsRequest extends ReplyableMessage<"artifactExistsRequest"> {
  readonly type: "artifactExistsRequest";
  readonly ref: ArtifactRef;
}

export interface ArtifactExistsCompleted {
  readonly type: "artifactExistsCompleted";
  readonly requestId: string;
  readonly ref: ArtifactRef;
  readonly exists: boolean;
}