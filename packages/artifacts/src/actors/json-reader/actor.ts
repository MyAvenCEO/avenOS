import { ActorId, buildActorDefinition, type ActorDefinitionMap, type JsonValue } from "typed-actors";
import { toReplyAddress } from "shared";
import type { AvenRegistry } from "../../../../runtime/src/spine.ts";
import type { JsonArtifactReaderMessage, JsonArtifactReaderState } from "../artifact/types.ts";
import type { ArtifactSubsystemSupport } from "../../subsystem.ts";
import { PendingArtifactActorBase } from "../../pending-actor-base.ts";
import { jsonArtifactReaderRuntime, jsonArtifactReaderShape } from "../artifact/shape.ts";
import { sendRequestResult } from "../../../../runtime/src/request-results.ts";

type RuntimeActorKind = typeof import("../../../../runtime/src/spine.ts").ActorKind;

export class JsonArtifactReaderActor extends PendingArtifactActorBase<{ readonly ref: import("artifact-contracts").ArtifactRef; readonly deadlineAt: string; readonly descriptor?: import("artifact-contracts").ArtifactDescriptor; readonly replyTo?: { readonly actorId: string; readonly actorKind: string } }> {
  constructor(support: ArtifactSubsystemSupport) {
    super(support);
  }

  buildDefinition(): ActorDefinitionMap<AvenRegistry>[RuntimeActorKind["JsonArtifactReader"]] {
    const { ActorKind } = this.support;
    return buildActorDefinition<AvenRegistry, RuntimeActorKind["JsonArtifactReader"], typeof jsonArtifactReaderShape>(jsonArtifactReaderShape, {
      kind: ActorKind.JsonArtifactReader,
      receive: {
        active: (ctx, rawMessage) => {
          const state = ctx.state as JsonArtifactReaderState;
          const message = rawMessage as JsonArtifactReaderMessage;
          if (message.type === "cleanupExpiredPending") {
            ctx.setState(this.cleanupPending(state, state.pendingByRequestId, (nextPending) => ({ ...state, pendingByRequestId: nextPending }), ctx.now));
            return;
          }
          if (message.type === "parseJson") {
            const requestId = this.support.createRequestId("artifact-json", state.nextRequestNumber, message.requestId);
            ctx.send({ id: ActorId.parse("/aven/system/artifacts"), kind: ActorKind.Artifacts }, {
              type: "artifactGetDescriptorRequest",
              requestId,
              ref: this.support.clone(message.ref),
              replyTo: toReplyAddress(ctx.self.id, ActorKind.JsonArtifactReader),
            } as never);
            ctx.setState({
              ...state,
              nextRequestNumber: this.nextRequestNumber(state.nextRequestNumber, message.requestId),
              pendingByRequestId: {
                ...state.pendingByRequestId,
                [requestId]: { ref: this.support.clone(message.ref), deadlineAt: this.support.pendingDeadline(ctx.now), replyTo: message.replyTo },
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
            if (!this.support.isSupportedJsonMime(message.descriptor.effectiveMimeType)) {
              const nextPending = { ...state.pendingByRequestId };
              delete nextPending[message.requestId];
              if (pending.replyTo) {
                sendRequestResult(ctx, pending.replyTo, message.requestId, {
                  type: "error",
                  error: { category: "invalidRequest", code: "ARTIFACT_MIME_UNSUPPORTED", message: `JSON reader does not support '${message.descriptor.effectiveMimeType}'.` },
                });
              }
              ctx.setState({ ...state, pendingByRequestId: nextPending });
              return;
            }
            const nextPending = { ...state.pendingByRequestId };
            delete nextPending[message.requestId];
            if (message.descriptor.blob.sizeBytes > this.support.MAX_JSON_ARTIFACT_BYTES) {
              if (pending.replyTo) {
                sendRequestResult(ctx, pending.replyTo, message.requestId, {
                  type: "error",
                  error: { category: "invalidRequest", code: "ARTIFACT_JSON_TOO_LARGE", message: `JSON artifacts cannot exceed ${this.support.MAX_JSON_ARTIFACT_BYTES} bytes.` },
                });
              }
              ctx.setState({ ...state, pendingByRequestId: nextPending });
              return;
            }
            void (async () => {
              try {
                const artifact = await this.support.storage.getArtifact(message.ref);
                if (!artifact) {
                  throw new Error(`Artifact '${message.ref.artifactId}' was not found.`);
                }
                const bytes = await this.support.storage.readBlob(artifact.blob);
                const value = JSON.parse(this.support.textDecoder.decode(bytes)) as JsonValue;
                if (pending.replyTo) {
                  sendRequestResult(ctx, pending.replyTo, message.requestId, {
                    type: "ok",
                    value: { type: "ok", value } as never,
                  });
                }
              } catch (error) {
                if (pending.replyTo) {
                  sendRequestResult(ctx, pending.replyTo, message.requestId, {
                    type: "error",
                    error: { category: "outputInvalid", code: "ARTIFACT_JSON_PARSE_FAILED", message: error instanceof Error ? error.message : "JSON parse failed." },
                  });
                }
              } finally {
                ctx.setState({
                  ...state,
                  pendingByRequestId: nextPending,
                });
              }
            })();
            return;
          }
          if (message.type !== "artifactReadBytesCompleted") {
            return;
          }
          return;
        },
      },
    });
  }
}