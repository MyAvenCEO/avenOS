import { ActorId, buildActorDefinition, type ActorDefinitionMap, type JsonValue } from "typed-actors";
import { toReplyAddress } from "shared";
import type { AvenRegistry } from "../../../../runtime/src/spine.ts";
import type { PendingTextRead, TextArtifactReaderMessage, TextArtifactReaderState } from "../artifact/types.ts";
import type { ArtifactSubsystemSupport } from "../../subsystem.ts";
import { PendingArtifactActorBase } from "../../pending-actor-base.ts";
import { textArtifactReaderRuntime, textArtifactReaderShape } from "../artifact/shape.ts";
import { sendRequestResult } from "../../../../runtime/src/request-results.ts";

type RuntimeActorKind = typeof import("../../../../runtime/src/spine.ts").ActorKind;

export class TextArtifactReaderActor extends PendingArtifactActorBase<PendingTextRead> {
  constructor(support: ArtifactSubsystemSupport) {
    super(support);
  }

  buildDefinition(): ActorDefinitionMap<AvenRegistry>[RuntimeActorKind["TextArtifactReader"]] {
    const { ActorKind } = this.support;
    return buildActorDefinition<AvenRegistry, RuntimeActorKind["TextArtifactReader"], typeof textArtifactReaderShape>(textArtifactReaderShape, {
      kind: ActorKind.TextArtifactReader,
      receive: {
        active: (ctx, rawMessage) => {
          const state = ctx.state as TextArtifactReaderState;
          const message = rawMessage as TextArtifactReaderMessage;
          if (message.type === "cleanupExpiredPending") {
            ctx.setState(this.cleanupPending(state, state.pendingByRequestId, (nextPending) => ({ ...state, pendingByRequestId: nextPending }), ctx.now));
            return;
          }
          if (message.type === "readTextPreview" || message.type === "readTextRange") {
            if (message.type === "readTextPreview" && (!Number.isInteger(message.maxChars) || message.maxChars <= 0)) {
              if (message.replyTo && message.requestId) {
                sendRequestResult(ctx, message.replyTo, message.requestId, {
                  type: "error",
                  error: { category: "invalidRequest", code: "ARTIFACT_TEXT_MAX_CHARS_INVALID", message: "maxChars must be a positive integer." },
                });
              }
              return;
            }
            if (message.type === "readTextPreview" && message.maxChars > this.support.DEFAULT_PREVIEW_MAX_CHARS) {
              if (message.replyTo && message.requestId) {
                sendRequestResult(ctx, message.replyTo, message.requestId, {
                  type: "error",
                  error: { category: "invalidRequest", code: "ARTIFACT_TEXT_MAX_CHARS_TOO_LARGE", message: `maxChars cannot exceed ${this.support.DEFAULT_PREVIEW_MAX_CHARS}.` },
                });
              }
              return;
            }
            const offsetBytes = message.type === "readTextRange" ? message.offsetBytes : 0;
            if (!Number.isInteger(offsetBytes) || offsetBytes < 0) {
              if (message.replyTo && message.requestId) {
                sendRequestResult(ctx, message.replyTo, message.requestId, {
                  type: "error",
                  error: { category: "invalidRequest", code: "ARTIFACT_TEXT_OFFSET_INVALID", message: "offsetBytes must be a non-negative integer." },
                });
              }
              return;
            }
            if (message.type === "readTextRange" && (!Number.isInteger(message.lengthBytes) || message.lengthBytes <= 0)) {
              if (message.replyTo && message.requestId) {
                sendRequestResult(ctx, message.replyTo, message.requestId, {
                  type: "error",
                  error: { category: "invalidRequest", code: "ARTIFACT_TEXT_LENGTH_INVALID", message: "lengthBytes must be a positive integer." },
                });
              }
              return;
            }
            const requestId = this.support.createRequestId("artifact-text", state.nextRequestNumber, message.requestId);
            ctx.send({ id: ActorId.parse("/aven/system/artifacts"), kind: ActorKind.Artifacts }, {
              type: "artifactGetDescriptorRequest",
              requestId,
              ref: this.support.clone(message.ref),
              replyTo: toReplyAddress(ctx.self.id, ActorKind.TextArtifactReader),
            } as never);
            ctx.setState({
              ...state,
              nextRequestNumber: this.nextRequestNumber(state.nextRequestNumber, message.requestId),
              pendingByRequestId: {
                ...state.pendingByRequestId,
                [requestId]: {
                  ref: this.support.clone(message.ref),
                  mode: message.type === "readTextPreview" ? "preview" : "range",
                  offsetBytes,
                  ...(message.type === "readTextPreview" ? { maxChars: message.maxChars } : { lengthBytes: message.lengthBytes }),
                  deadlineAt: this.support.pendingDeadline(ctx.now),
                  replyTo: message.replyTo,
                },
              },
            });
            return;
          }
          if (message.type === "artifactGetDescriptorCompleted") {
            const pending = state.pendingByRequestId[message.requestId];
            if (!pending) return;
            if (!message.descriptor) {
              const nextPending = { ...state.pendingByRequestId };
              delete nextPending[message.requestId];
              if (pending.replyTo) {
                sendRequestResult(ctx, pending.replyTo, message.requestId, {
                  type: "error",
                  error: { category: "notFound", code: "ARTIFACT_MISSING", message: `Artifact '${message.ref.artifactId}' was not found.` },
                });
              }
              ctx.setState({ ...state, pendingByRequestId: nextPending });
              return;
            }
            if (!this.support.isSupportedTextMime(message.descriptor.effectiveMimeType)) {
              const nextPending = { ...state.pendingByRequestId };
              delete nextPending[message.requestId];
              if (pending.replyTo) {
                sendRequestResult(ctx, pending.replyTo, message.requestId, {
                  type: "error",
                  error: { category: "invalidRequest", code: "ARTIFACT_MIME_UNSUPPORTED", message: `Text reader does not support '${message.descriptor.effectiveMimeType}'.` },
                });
              }
              ctx.setState({ ...state, pendingByRequestId: nextPending });
              return;
            }
            ctx.send({ id: ActorId.parse("/aven/system/artifacts"), kind: ActorKind.Artifacts }, {
              type: "artifactReadBytesRequest",
              requestId: message.requestId,
              ref: this.support.clone(message.ref),
              offsetBytes: pending.offsetBytes,
              lengthBytes: pending.mode === "range"
                ? Math.min(message.descriptor.blob.sizeBytes - pending.offsetBytes, this.support.MAX_ARTIFACT_READ_BYTES, Math.max(pending.lengthBytes ?? 1, 1))
                : Math.min(message.descriptor.blob.sizeBytes, this.support.MAX_ARTIFACT_READ_BYTES, Math.max(pending.maxChars ?? 1, 1)),
              replyTo: toReplyAddress(ctx.self.id, ActorKind.TextArtifactReader),
            } as never);
            ctx.setState({
              ...state,
              pendingByRequestId: { ...state.pendingByRequestId, [message.requestId]: { ...pending, descriptor: this.support.clone(message.descriptor) } },
            });
            return;
          }
          if (message.type !== "artifactReadBytesCompleted") {
            return;
          }
          const pending = state.pendingByRequestId[message.requestId];
          if (!pending) return;
          const nextPending = { ...state.pendingByRequestId };
          delete nextPending[message.requestId];
          if (message.result.type === "error") {
            if (pending.replyTo) {
              sendRequestResult(ctx, pending.replyTo, message.requestId, {
                type: "error",
                error: { category: "operationFailed", code: "ARTIFACT_READ_FAILED", message: message.result.error.message },
              });
            }
            ctx.setState({ ...state, pendingByRequestId: nextPending });
            return;
          }
          const text = this.support.textDecoder.decode(this.support.decodeReadBytesResult(message.result));
          const slice = pending.mode === "preview" ? text.slice(0, pending.maxChars ?? 0) : text;
          if (pending.replyTo) {
            sendRequestResult(ctx, pending.replyTo, message.requestId, {
              type: "ok",
              value: {
                type: "ok",
                text: slice,
                offsetBytes: message.result.offset,
                lengthBytes: message.result.length,
                totalSizeBytes: message.result.totalSizeBytes,
                truncated: pending.mode === "preview"
                      ? (pending.descriptor?.blob.sizeBytes ?? message.result.totalSizeBytes) > message.result.length || text.length > (pending.maxChars ?? 0)
                  : false,
                effectiveMimeType: pending.descriptor?.effectiveMimeType ?? "text/plain",
              } as never,
            });
          }
          ctx.setState({
            ...state,
            pendingByRequestId: nextPending,
          });
        },
      },
    });
  }
}