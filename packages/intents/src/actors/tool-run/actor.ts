import { StopReasonType, buildActorDefinition, type ActorDefinitionMap, type JsonValue } from "typed-actors";
import { Buffer } from "node:buffer";
import type { AvenRegistry } from "../../../../runtime/src/spine.ts";
import type { IntentToolRunMessage, IntentToolRunState, ToolRunCompletedMessage } from "../intent/types.ts";
import type { IntentSubsystemSupport } from "../../subsystem.ts";
import { intentToolRunShape } from "../intent/shape.ts";

type RuntimeActorKind = typeof import("../../../../runtime/src/spine.ts").ActorKind;

export class IntentToolRunActor {
  constructor(private readonly support: IntentSubsystemSupport) {}

  buildDefinition(): ActorDefinitionMap<AvenRegistry>[RuntimeActorKind["IntentToolRun"]] {
    return buildActorDefinition<AvenRegistry, RuntimeActorKind["IntentToolRun"], typeof intentToolRunShape>(intentToolRunShape, {
      kind: this.support.IntentToolRunKind,
      receive: {
        active: (ctx, message: IntentToolRunMessage) => {
          const state = ctx.state as unknown as IntentToolRunState;
          const complete = (result: JsonValue) => {
            const normalized = this.support.completeToolRunResult(state, result);
            const nextState = {
              ...state,
              status: "completed",
              result: normalized,
            } as unknown as typeof ctx.state;
            ctx.setState(ctx.rt.normalizeState(nextState as any) as IntentToolRunState);
            if (ctx.parent) {
              ctx.send(ctx.parent, {
                type: "toolRunCompleted",
                runId: state.runId,
                toolId: state.toolId,
                input: this.support.sanitizeJson(this.support.clone(state.input) as JsonValue),
                result: normalized,
              } satisfies ToolRunCompletedMessage as never);
            }
            ctx.stop({ type: StopReasonType.Completed });
          };
          if (message.type === "metadataRecordCompleted" || message.type === "metadataQueryCompleted") {
            if (message.requestId !== state.runId) return;
            complete(message.result);
            return;
          }
          if (message.type === "structuredExtractionCompleted") {
            if (message.requestId !== state.runId) return;
            complete(message.result as unknown as JsonValue);
            return;
          }
          if (message.type === "artifactGetDescriptorCompleted") {
            if (message.requestId !== state.runId) return;
            complete({
              type: "ok",
              ref: this.support.clone(message.ref),
              descriptor: message.descriptor
                ? {
                    blob: this.support.clone(message.descriptor.blob),
                    artifactId: message.descriptor.artifactId,
                    effectiveMimeType: message.descriptor.effectiveMimeType,
                    detectedMimeType: message.descriptor.detectedMimeType,
                    createdAt: message.descriptor.createdAt,
                  }
                : null,
            } as unknown as JsonValue);
            return;
          }
          if (message.type === "artifactReadBytesCompleted") {
            if (message.requestId !== state.runId) return;
            if (state.toolId === "intent.readArtifact") {
              const input = this.support.clone(state.input) as { readonly offsetBytes: number; readonly lengthBytes: number; readonly mode?: "bytes" | "text" };
              const actualLength = Math.min(input.lengthBytes, state.artifactReadMaxBytes);
              const clamped = actualLength < input.lengthBytes
                ? { requestedLengthBytes: input.lengthBytes, actualLengthBytes: actualLength, hint: "Use offsetBytes to page through the artifact." }
                : undefined;
              if (message.result.type === "error") {
                complete({ inner: message.result, ...(clamped ? { clamped } : {}) } as unknown as JsonValue);
                return;
              }
              const inner = (input.mode ?? "text") === "bytes"
                ? message.result
                : {
                    type: "ok",
                    offsetBytes: message.result.offset,
                    lengthBytes: message.result.length,
                    totalSizeBytes: message.result.totalSizeBytes,
                    text: Buffer.from(message.result.bytesBase64, "base64").toString("utf8"),
                  };
              complete({ inner, ...(clamped ? { clamped } : {}) } as unknown as JsonValue);
              return;
            }
            complete(message.result as unknown as JsonValue);
            return;
          }
          if (message.type === "shellExecuteCompleted") {
            if (message.requestId !== state.runId) return;
            complete(message.result as unknown as JsonValue);
            return;
          }
          if (message.type === "schemaValidationCompleted" || message.type === "schemaVersionCompleted") {
            if (message.requestId !== state.runId) return;
            complete(message.result as unknown as JsonValue);
            return;
          }
          if (message.type !== "startToolRun") return;
          const tool = this.support.toolCatalogById.get(state.toolId);
          if (!tool || !tool.execute) {
            complete(this.support.intentError("toolRejected", `Unknown toolId '${state.toolId}' rejected before execution.`));
            return;
          }
          tool.execute(ctx as never, state);
        },
      },
    });
  }
}
