import type { JsonValue } from "typed-actors";
import type { ReplyableMessage } from "../../../actor-contracts/src/types/actor-message.ts";
import type { ArtifactRef } from "../types/artifact-ref.ts";

export interface ArtifactReadBytesOk {
  readonly type: "ok";
  readonly bytesBase64: string;
  readonly offset: number;
  readonly length: number;
  readonly totalSizeBytes: number;
}

export interface ArtifactReadBytesError {
  readonly type: "error";
  readonly error: {
    readonly category:
      | "artifactMissing"
      | "invalidRequest"
      | "rangeOutOfBounds"
      | "readTooLarge"
      | "storageInconsistent"
      | "unsupportedMime"
      | "outputInvalid";
    readonly message: string;
    readonly details?: JsonValue;
  };
}

export interface ArtifactReadBytesRequest extends ReplyableMessage<"artifactReadBytesRequest"> {
  readonly type: "artifactReadBytesRequest";
  readonly ref: ArtifactRef;
  readonly offsetBytes: number;
  readonly lengthBytes: number;
}

export interface ArtifactReadBytesCompleted {
  readonly type: "artifactReadBytesCompleted";
  readonly requestId: string;
  readonly ref: ArtifactRef;
  readonly result: ArtifactReadBytesOk | ArtifactReadBytesError;
}