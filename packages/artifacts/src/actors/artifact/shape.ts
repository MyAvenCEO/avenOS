import { buildActorRuntime, defineActorShape, field, msg, type DerivedActorRuntime } from "typed-actors";
import type {
  ArtifactActorMessage,
  ArtifactActorState,
  ArtifactReaderRegistryState,
  ByteArtifactReaderState,
  JsonArtifactReaderState,
  PendingTextRead,
  TextArtifactReaderState,
} from "./types.ts";
import type { ArtifactDescriptor, ArtifactRef } from "artifact-contracts";

/** Declarative artifact actor shape for guard/init/result-helper derivation. */
export const artifactActorShape = defineActorShape({
  kind: "artifacts",
  state: {
    registeredCount: field.integer({ default: 0 }),
    lastRegisteredAt: field.string({ optional: true }),
  },
  messages: {
    putText: msg({
      text: field.string(),
      requestId: field.string({ optional: true }),
      replyTo: field.ref<{ readonly actorId: string; readonly actorKind: string }>({ optional: true }),
      declaredMimeType: field.string({ optional: true }),
      filename: field.string({ optional: true }),
    }),
    putJson: msg({
      requestId: field.string({ optional: true }),
      replyTo: field.ref<{ readonly actorId: string; readonly actorKind: string }>({ optional: true }),
      value: field.json(),
      filename: field.string({ optional: true }),
    }),
    putBase64: msg({
      requestId: field.string({ optional: true }),
      replyTo: field.ref<{ readonly actorId: string; readonly actorKind: string }>({ optional: true }),
      base64: field.string(),
      declaredMimeType: field.string({ optional: true }),
      filename: field.string({ optional: true }),
    }),
    artifactExistsRequest: msg({
      requestId: field.string(),
      ref: field.ref<ArtifactRef>(),
      replyTo: field.ref<{ readonly actorId: string; readonly actorKind: string }>(),
    }),
    artifactGetDescriptorRequest: msg({
      requestId: field.string(),
      ref: field.ref<ArtifactRef>(),
      replyTo: field.ref<{ readonly actorId: string; readonly actorKind: string }>(),
    }),
    artifactReadBytesRequest: msg({
      requestId: field.string(),
      ref: field.ref<ArtifactRef>(),
      offsetBytes: field.number(),
      lengthBytes: field.number(),
      replyTo: field.ref<{ readonly actorId: string; readonly actorKind: string }>(),
    }),
  },
  present(state) {
    return { title: "artifacts", subtitle: `${state.registeredCount} artifacts` };
  },
});

export const artifactActorRuntime = buildActorRuntime(artifactActorShape) as DerivedActorRuntime<
  typeof artifactActorShape.messages,
  ArtifactActorState
>;

export function isArtifactShapeMessage(value: unknown): value is ArtifactActorMessage {
  return artifactActorRuntime.isMessage(value);
}

export const artifactReaderRegistryShape = defineActorShape({
  kind: "artifactReaderRegistry",
  state: {
    pendingDescriptorsByRequestId: field.ref<ArtifactReaderRegistryState["pendingDescriptorsByRequestId"]>({ default: {} as ArtifactReaderRegistryState["pendingDescriptorsByRequestId"] }),
    nextRequestNumber: field.integer({ default: 1 }),
  },
  messages: {
    cleanupExpiredPending: msg({}),
    listReaders: msg({
      requestId: field.string(),
      replyTo: field.ref<{ readonly actorId: string; readonly actorKind: string }>(),
    }),
    listCompatibleReaders: msg({
      requestId: field.string(),
      replyTo: field.ref<{ readonly actorId: string; readonly actorKind: string }>(),
      ref: field.ref<ArtifactRef>(),
    }),
    artifactGetDescriptorCompleted: msg({
      requestId: field.string(),
      ref: field.ref<ArtifactRef>(),
      descriptor: field.ref<ArtifactDescriptor>({ optional: true }),
    }),
  },
});

export const byteArtifactReaderShape = defineActorShape({
  kind: "byteArtifactReader",
  state: {
    pendingByRequestId: field.ref<ByteArtifactReaderState["pendingByRequestId"]>({ default: {} as ByteArtifactReaderState["pendingByRequestId"] }),
    nextRequestNumber: field.integer({ default: 1 }),
  },
  messages: {
    cleanupExpiredPending: msg({}),
    readBytes: msg({
      requestId: field.string(),
      replyTo: field.ref<{ readonly actorId: string; readonly actorKind: string }>(),
      ref: field.ref<ArtifactRef>(),
      offsetBytes: field.number(),
      lengthBytes: field.number(),
    }),
    artifactReadBytesCompleted: msg({
      requestId: field.string(),
      ref: field.ref<ArtifactRef>(),
      result: field.ref<import("artifact-contracts").ArtifactReadBytesCompleted["result"]>(),
    }),
    artifactGetDescriptorCompleted: msg({
      requestId: field.string(),
      ref: field.ref<ArtifactRef>(),
      descriptor: field.ref<ArtifactDescriptor>({ optional: true }),
    }),
  },
  present(state) {
    return { title: "bytes", subtitle: `${Object.keys(state.pendingByRequestId).length} pending` };
  },
});

export const textArtifactReaderShape = defineActorShape({
  kind: "textArtifactReader",
  state: {
    pendingByRequestId: field.ref<Readonly<Record<string, PendingTextRead>>>({ default: {} as Readonly<Record<string, PendingTextRead>> }),
    nextRequestNumber: field.integer({ default: 1 }),
  },
  messages: {
    cleanupExpiredPending: msg({}),
    readTextPreview: msg({
      requestId: field.string(),
      replyTo: field.ref<{ readonly actorId: string; readonly actorKind: string }>(),
      ref: field.ref<ArtifactRef>(),
      maxChars: field.number(),
    }),
    readTextRange: msg({
      requestId: field.string(),
      replyTo: field.ref<{ readonly actorId: string; readonly actorKind: string }>(),
      ref: field.ref<ArtifactRef>(),
      offsetBytes: field.number(),
      lengthBytes: field.number(),
    }),
    artifactGetDescriptorCompleted: msg({
      requestId: field.string(),
      ref: field.ref<ArtifactRef>(),
      descriptor: field.ref<ArtifactDescriptor>({ optional: true }),
    }),
    artifactReadBytesCompleted: msg({
      requestId: field.string(),
      ref: field.ref<ArtifactRef>(),
      result: field.ref<import("artifact-contracts").ArtifactReadBytesCompleted["result"]>(),
    }),
  },
  present(state) {
    return { title: "text", subtitle: `${Object.keys(state.pendingByRequestId).length} pending` };
  },
});

export const jsonArtifactReaderShape = defineActorShape({
  kind: "jsonArtifactReader",
  state: {
    pendingByRequestId: field.ref<JsonArtifactReaderState["pendingByRequestId"]>({ default: {} as JsonArtifactReaderState["pendingByRequestId"] }),
    nextRequestNumber: field.integer({ default: 1 }),
  },
  messages: {
    cleanupExpiredPending: msg({}),
    parseJson: msg({
      requestId: field.string(),
      replyTo: field.ref<{ readonly actorId: string; readonly actorKind: string }>(),
      ref: field.ref<ArtifactRef>(),
    }),
    artifactGetDescriptorCompleted: msg({
      requestId: field.string(),
      ref: field.ref<ArtifactRef>(),
      descriptor: field.ref<ArtifactDescriptor>({ optional: true }),
    }),
    artifactReadBytesCompleted: msg({
      requestId: field.string(),
      ref: field.ref<ArtifactRef>(),
      result: field.ref<import("artifact-contracts").ArtifactReadBytesCompleted["result"]>(),
    }),
  },
  present(state) {
    return { title: "json", subtitle: `${Object.keys(state.pendingByRequestId).length} pending` };
  },
});

export const artifactReaderRegistryRuntime = buildActorRuntime(artifactReaderRegistryShape) as DerivedActorRuntime<
  typeof artifactReaderRegistryShape.messages,
  ArtifactReaderRegistryState
>;
export const byteArtifactReaderRuntime = buildActorRuntime(byteArtifactReaderShape) as DerivedActorRuntime<
  typeof byteArtifactReaderShape.messages,
  ByteArtifactReaderState
>;
export const textArtifactReaderRuntime = buildActorRuntime(textArtifactReaderShape) as DerivedActorRuntime<
  typeof textArtifactReaderShape.messages,
  TextArtifactReaderState
>;
export const jsonArtifactReaderRuntime = buildActorRuntime(jsonArtifactReaderShape) as DerivedActorRuntime<
  typeof jsonArtifactReaderShape.messages,
  JsonArtifactReaderState
>;