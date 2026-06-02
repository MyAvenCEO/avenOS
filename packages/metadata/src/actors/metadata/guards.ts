import type { MetadataActorMessage } from "./shape.ts";
import { metadataActorRuntime } from "./shape.ts";

export function isMetadataActorMessage(value: unknown): value is MetadataActorMessage {
  return metadataActorRuntime.isMessage(value);
}