import { ActorId, buildActorDefinition, type ActorDefinitionMap, type JsonValue } from "typed-actors";
import { toReplyAddress } from "shared";
import type { AvenRegistry } from "../../../../runtime/src/spine.ts";
import type { ArtifactReaderRegistryMessage } from "../artifact/types.ts";
import type { ArtifactSubsystemSupport } from "../../subsystem.ts";
import { PendingArtifactActorBase } from "../../pending-actor-base.ts";
import { artifactReaderRegistryRuntime, artifactReaderRegistryShape } from "../artifact/shape.ts";
import { sendRequestResult } from "../../../../runtime/src/request-results.ts";

type RuntimeActorKind = typeof import("../../../../runtime/src/spine.ts").ActorKind;

export class ArtifactReaderRegistryActor extends PendingArtifactActorBase<{ readonly ref: import("artifact-contracts").ArtifactRef; readonly deadlineAt: string; readonly replyTo?: { readonly actorId: string; readonly actorKind: string } }> {
  constructor(support: ArtifactSubsystemSupport) {
    super(support);
  }

  buildDefinition(): ActorDefinitionMap<AvenRegistry>[RuntimeActorKind["ArtifactReaderRegistry"]] {
    const { ActorKind } = this.support;
    return buildActorDefinition<AvenRegistry, RuntimeActorKind["ArtifactReaderRegistry"], typeof artifactReaderRegistryShape>(artifactReaderRegistryShape, {
      kind: ActorKind.ArtifactReaderRegistry,
      onStart: (ctx) => {
        ctx.spawn(ActorKind.ByteArtifactReader, { id: ctx.self.id.child("bytes"), init: {} });
        ctx.spawn(ActorKind.TextArtifactReader, { id: ctx.self.id.child("text"), init: {} });
        ctx.spawn(ActorKind.JsonArtifactReader, { id: ctx.self.id.child("json"), init: {} });
      },
      receive: {
        active: (ctx, rawMessage) => {
          const state = ctx.state as import("../artifact/types.ts").ArtifactReaderRegistryState;
          const message = rawMessage as ArtifactReaderRegistryMessage;
          if (message.type === "cleanupExpiredPending") {
            ctx.setState(this.cleanupPending(
              state,
              state.pendingDescriptorsByRequestId,
              (nextPending) => ({ ...state, pendingDescriptorsByRequestId: nextPending }),
              ctx.now,
            ));
            return;
          }
          if (message.type === "listReaders") {
            if (message.requestId && message.replyTo) {
              sendRequestResult(ctx, message.replyTo, message.requestId, {
                type: "ok",
                value: this.support.readerDescriptors() as never,
              });
            }
            return;
          }
          if (message.type === "listCompatibleReaders") {
            const requestId = this.support.createRequestId("artifact-reader-compat", state.nextRequestNumber, message.requestId);
            ctx.send({ id: ActorId.parse("/aven/system/artifacts"), kind: ActorKind.Artifacts }, {
              type: "artifactGetDescriptorRequest",
              requestId,
              ref: this.support.clone(message.ref),
              replyTo: toReplyAddress(ctx.self.id, ActorKind.ArtifactReaderRegistry),
            } as never);
            ctx.setState({
              ...state,
              nextRequestNumber: this.nextRequestNumber(state.nextRequestNumber, message.requestId),
              pendingDescriptorsByRequestId: {
                ...state.pendingDescriptorsByRequestId,
                [requestId]: { ref: this.support.clone(message.ref), deadlineAt: this.support.pendingDeadline(ctx.now), replyTo: message.replyTo },
              },
            });
            return;
          }
          if (message.type !== "artifactGetDescriptorCompleted") {
            return;
          }
          const pending = state.pendingDescriptorsByRequestId[message.requestId];
          if (!pending) return;
          const nextPending = { ...state.pendingDescriptorsByRequestId };
          delete nextPending[message.requestId];
          if (pending.replyTo) {
            sendRequestResult(ctx, pending.replyTo, message.requestId, {
              type: message.descriptor ? "ok" : "error",
              ...(message.descriptor
                ? { value: this.support.compatibleReadersForDescriptor(message.descriptor) as never }
                : { error: { category: "notFound", code: "ARTIFACT_MISSING", message: `Artifact '${message.ref.artifactId}' was not found.` } }),
            } as never);
          }
          ctx.setState({
            ...state,
            pendingDescriptorsByRequestId: nextPending,
          });
        },
      },
      present() {
        return { title: "artifact-readers", subtitle: "bounded artifact readers" };
      },
    });
  }
}