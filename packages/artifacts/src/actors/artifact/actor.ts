import {
  buildActorDefinition,
  defineActor,
  type ActorDefinitionMap,
  type ActorModule,
  type JsonValue,
} from "typed-actors";
import { ErrorCategory } from "actor-contracts";
import type { AvenRegistry } from "../../../../runtime/src/spine.ts";
import type { ArtifactActorMessage, ArtifactActorState } from "./types.ts";
import type { ArtifactSubsystemSupport } from "../../subsystem.ts";
import { artifactActorRuntime, artifactActorShape } from "./shape.ts";
import { sendRequestResult } from "../../../../runtime/src/request-results.ts";

type RuntimeActorKind = typeof import("../../../../runtime/src/spine.ts").ActorKind;

export class ArtifactActor {
  constructor(private readonly support: ArtifactSubsystemSupport) {}

  buildDefinition(): ActorDefinitionMap<AvenRegistry>[RuntimeActorKind["Artifacts"]] {
    const { ActorKind } = this.support;
    const definition: ActorModule<AvenRegistry, RuntimeActorKind["Artifacts"]> = buildActorDefinition<AvenRegistry, RuntimeActorKind["Artifacts"], typeof artifactActorShape>(artifactActorShape, {
      kind: ActorKind.Artifacts,
      receive: {
        active: async (ctx, rawMessage) => {
          const state = ctx.state as ArtifactActorState;
          const message = rawMessage as ArtifactActorMessage;
          if (message.type === "artifactExistsRequest") {
            const target = this.support.replyTarget(message.replyTo);
            const exists = await this.support.storage.getArtifact(message.ref).then((artifact) => artifact !== undefined);
            ctx.send(target, {
              type: "artifactExistsCompleted",
              requestId: message.requestId,
              ref: this.support.clone(message.ref),
              exists,
            } as never);
            return;
          }
          if (message.type === "artifactGetDescriptorRequest") {
            const target = this.support.replyTarget(message.replyTo);
            const descriptor = await this.support.storage.getArtifact(message.ref);
            ctx.send(target, {
              type: "artifactGetDescriptorCompleted",
              requestId: message.requestId,
              ref: this.support.clone(message.ref),
              ...(descriptor ? { descriptor: this.support.clone(descriptor) } : {}),
            } as never);
            return;
          }
          if (message.type === "artifactReadBytesRequest") {
            const target = this.support.replyTarget(message.replyTo);
            ctx.send(target, {
              type: "artifactReadBytesCompleted",
              requestId: message.requestId,
              ref: this.support.clone(message.ref),
              result: await this.support.readArtifactBytesResult(this.support.storage, message.ref, message.offsetBytes, message.lengthBytes),
            } as never);
            return;
          }
          if (message.type === "putText") {
            const bytes = this.support.textEncoder.encode(message.text);
            const artifact = await this.support.storage.putArtifact({
              bytes,
              declaredMimeType: message.declaredMimeType ?? "text/plain",
              filename: message.filename,
              createdAt: ctx.now.toISOString(),
            });
            const descriptor = { ref: artifact.blob, detectedMimeType: artifact.detectedMimeType, effectiveMimeType: artifact.effectiveMimeType, createdAt: artifact.createdAt };
            const nextState = this.support.toStateRecord(state, descriptor);
            if (message.requestId && message.replyTo) {
              sendRequestResult(ctx, message.replyTo, message.requestId, { type: "ok", value: this.support.clone(artifact as unknown as JsonValue) });
            }
            ctx.setState(nextState);
            return;
          }
          if (message.type === "putJson") {
            const bytes = this.support.textEncoder.encode(this.support.stableJsonStringify(message.value));
            const artifact = await this.support.storage.putArtifact({ bytes, declaredMimeType: "application/json", filename: message.filename, createdAt: ctx.now.toISOString() });
            const descriptor = { ref: artifact.blob, detectedMimeType: artifact.detectedMimeType, effectiveMimeType: artifact.effectiveMimeType, createdAt: artifact.createdAt };
            const nextState = this.support.toStateRecord(state, descriptor);
            if (message.requestId && message.replyTo) {
              sendRequestResult(ctx, message.replyTo, message.requestId, { type: "ok", value: this.support.clone(artifact as unknown as JsonValue) });
            }
            ctx.setState(nextState);
            return;
          }
          const bytes = this.support.decodeBase64(message.base64);
          if (!bytes) {
            if (message.requestId && message.replyTo) {
              sendRequestResult(ctx, message.replyTo, message.requestId, {
                type: "error",
                error: {
                  category: ErrorCategory.InvalidRequest,
                  code: "ARTIFACT_BASE64_INVALID",
                  message: "Invalid base64 input.",
                },
              });
            }
            return;
          }
          const artifact = await this.support.storage.putArtifact({ bytes, declaredMimeType: message.declaredMimeType ?? "application/octet-stream", filename: message.filename, createdAt: ctx.now.toISOString() });
          const descriptor = { ref: artifact.blob, detectedMimeType: artifact.detectedMimeType, effectiveMimeType: artifact.effectiveMimeType, createdAt: artifact.createdAt };
          const nextState = this.support.toStateRecord(state, descriptor);
          if (message.requestId && message.replyTo) {
            sendRequestResult(ctx, message.replyTo, message.requestId, { type: "ok", value: this.support.clone(artifact as unknown as JsonValue) });
          }
          ctx.setState(nextState);
        },
      },

    });
    return definition;
  }
}
