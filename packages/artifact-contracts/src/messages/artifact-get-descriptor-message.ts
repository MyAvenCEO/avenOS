import type { ReplyableMessage } from "../../../actor-contracts/src/types/actor-message.ts";
import type { ArtifactDescriptor } from "../types/artifact-descriptor.ts";
import type { ArtifactRef } from "../types/artifact-ref.ts";

export interface ArtifactGetDescriptorRequest extends ReplyableMessage<"artifactGetDescriptorRequest"> {
  readonly type: "artifactGetDescriptorRequest";
  readonly ref: ArtifactRef;
}

export interface ArtifactGetDescriptorCompleted {
  readonly type: "artifactGetDescriptorCompleted";
  readonly requestId: string;
  readonly ref: ArtifactRef;
  readonly descriptor?: ArtifactDescriptor;
}