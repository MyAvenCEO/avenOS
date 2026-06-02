import type {
  ArtifactExistsCompleted,
  ArtifactExistsRequest,
  ArtifactGetDescriptorCompleted,
  ArtifactGetDescriptorRequest,
  ArtifactReadBytesCompleted,
  ArtifactReadBytesRequest,
  ArtifactDescriptor,
  ArtifactRef,
} from "artifact-contracts";
import type { CleanupExpiredPendingMessage } from "../../messages/cleanup-expired-pending.ts";
import type { ListCompatibleReadersMessage } from "../../messages/list-compatible-readers.ts";
import type { ListReadersMessage } from "../../messages/list-readers.ts";
import type { ParseJsonMessage } from "../../messages/parse-json.ts";
import type { PutBase64Message } from "../../messages/put-base64.ts";
import type { PutJsonMessage } from "../../messages/put-json.ts";
import type { PutTextMessage } from "../../messages/put-text.ts";
import type { ReadBytesMessage } from "../../messages/read-bytes.ts";
import type { ReadTextPreviewMessage } from "../../messages/read-text-preview.ts";
import type { ReadTextRangeMessage } from "../../messages/read-text-range.ts";

export type {
  ArtifactExistsCompleted,
  ArtifactExistsRequest,
  ArtifactGetDescriptorCompleted,
  ArtifactGetDescriptorRequest,
  ArtifactReadBytesCompleted,
  ArtifactReadBytesRequest,
  ArtifactDescriptor,
  ArtifactRef,
};

export type ArtifactActorState = {
  readonly registeredCount: number;
  readonly lastRegisteredAt?: string;
};

export type ArtifactActorMessage =
  | PutTextMessage
  | PutJsonMessage
  | PutBase64Message
  | ArtifactExistsRequest
  | ArtifactGetDescriptorRequest
  | ArtifactReadBytesRequest;

export interface ArtifactReaderRegistryState {
  readonly pendingDescriptorsByRequestId: Readonly<Record<string, {
    readonly ref: ArtifactRef;
    readonly deadlineAt: string;
    readonly replyTo?: { readonly actorId: string; readonly actorKind: string };
  }>>;
  readonly nextRequestNumber: number;
}

export interface ByteArtifactReaderState {
  readonly pendingByRequestId: Readonly<Record<string, {
    readonly ref: ArtifactRef;
    readonly deadlineAt: string;
    readonly replyTo?: { readonly actorId: string; readonly actorKind: string };
  }>>;
  readonly nextRequestNumber: number;
}

export interface PendingTextRead {
  readonly ref: ArtifactRef;
  readonly mode: "preview" | "range";
  readonly offsetBytes: number;
  readonly lengthBytes?: number;
  readonly maxChars?: number;
  readonly deadlineAt: string;
  readonly replyTo?: { readonly actorId: string; readonly actorKind: string };
  readonly descriptor?: ArtifactDescriptor;
}

export interface TextArtifactReaderState {
  readonly pendingByRequestId: Readonly<Record<string, PendingTextRead>>;
  readonly nextRequestNumber: number;
}

export interface JsonArtifactReaderState {
  readonly pendingByRequestId: Readonly<Record<string, {
    readonly ref: ArtifactRef;
    readonly deadlineAt: string;
    readonly replyTo?: { readonly actorId: string; readonly actorKind: string };
    readonly descriptor?: ArtifactDescriptor;
  }>>;
  readonly nextRequestNumber: number;
}

export type ArtifactReaderRegistryMessage = ListReadersMessage | ListCompatibleReadersMessage | CleanupExpiredPendingMessage | ArtifactGetDescriptorCompleted;
export type ByteArtifactReaderMessage = ReadBytesMessage | CleanupExpiredPendingMessage | ArtifactReadBytesCompleted | ArtifactGetDescriptorCompleted;
export type TextArtifactReaderMessage = ReadTextPreviewMessage | ReadTextRangeMessage | CleanupExpiredPendingMessage | ArtifactGetDescriptorCompleted | ArtifactReadBytesCompleted;
export type JsonArtifactReaderMessage = ParseJsonMessage | CleanupExpiredPendingMessage | ArtifactGetDescriptorCompleted | ArtifactReadBytesCompleted;