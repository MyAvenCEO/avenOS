import { ActorId, buildActorDefinition, type ActorDefinitionMap } from "typed-actors";
import { toReplyAddress } from "shared";
import type { AvenRegistry } from "../../../../runtime/src/spine.ts";
import type { ByteArtifactReaderMessage, ByteArtifactReaderState } from "../artifact/types.ts";
import type { ArtifactSubsystemSupport } from "../../subsystem.ts";
import { PendingArtifactActorBase } from "../../pending-actor-base.ts";
import { byteArtifactReaderRuntime, byteArtifactReaderShape } from "../artifact/shape.ts";
import { sendRequestResult } from "../../../../runtime/src/request-results.ts";

type RuntimeActorKind = typeof import("../../../../runtime/src/spine.ts").ActorKind;

export class ByteArtifactReaderActor extends PendingArtifactActorBase<{ readonly ref: import("artifact-contracts").ArtifactRef; readonly deadlineAt: string; readonly replyTo?: { readonly actorId: string; readonly actorKind: string } }> {
  constructor(support: ArtifactSubsystemSupport) {
    super(support);
  }

  buildDefinition(): ActorDefinitionMap<AvenRegistry>[RuntimeActorKind["ByteArtifactReader"]] {
    const { ActorKind } = this.support;
    return buildActorDefinition<AvenRegistry, RuntimeActorKind["ByteArtifactReader"], typeof byteArtifactReaderShape>(byteArtifactReaderShape, {
      kind: ActorKind.ByteArtifactReader,
      receive: {
        active: (ctx, rawMessage) => {
          const state = ctx.state as ByteArtifactReaderState;
          const message = rawMessage as ByteArtifactReaderMessage;
          if (message.type === "cleanupExpiredPending") {
            ctx.setState(this.cleanupPending(state, state.pendingByRequestId, (nextPending) => ({ ...state, pendingByRequestId: nextPending }), ctx.now));
            return;
          }
          if (message.type === "readBytes") {
            const requestId = this.support.createRequestId("artifact-bytes", state.nextRequestNumber, message.requestId);
            ctx.send({ id: ActorId.parse("/aven/system/artifacts"), kind: ActorKind.Artifacts }, {
              type: "artifactReadBytesRequest",
              requestId,
              ref: this.support.clone(message.ref),
              offsetBytes: message.offsetBytes,
              lengthBytes: message.lengthBytes,
              replyTo: toReplyAddress(ctx.self.id, ActorKind.ByteArtifactReader),
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
            return;
          }
          if (message.type !== "artifactReadBytesCompleted") {
            return;
          }
          const pending = state.pendingByRequestId[message.requestId];
          if (!pending) return;
          if (pending.replyTo) {
            sendRequestResult(ctx, pending.replyTo, message.requestId, {
              type: message.result.type === "ok" ? "ok" : "error",
              ...(message.result.type === "ok"
                ? { value: this.support.clone(message.result as unknown as import("typed-actors").JsonValue) }
                : {
                    error: {
                      category: "operationFailed",
                      code: "ARTIFACT_READ_FAILED",
                      message: message.result.error.message,
                      ...(message.result.error.details === undefined ? {} : { details: this.support.clone(message.result.error.details) }),
                    },
                  }),
            } as never);
          }
          const nextPending = { ...state.pendingByRequestId };
          delete nextPending[message.requestId];
          ctx.setState({ ...state, pendingByRequestId: nextPending });
        },
      },
    });
  }
}