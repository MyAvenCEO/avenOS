import { ActorId, StopReasonType, buildActorDefinition, defineActorShape, field, msg, type ActorDefinitionMap } from "typed-actors";
import type { AvenRegistry } from "../../../../runtime/src/spine.ts";
import type { ShellExecuteCompletion, ShellExecuteRequest } from "../../../../shell-contracts/src/index.ts";
import type { ShellSubsystemSupport } from "../../subsystem.ts";
import { executeShellCommand } from "../../shell-execute.ts";

type RuntimeActorKind = typeof import("../../../../runtime/src/spine.ts").ActorKind;

export type ShellActorState = {};
export type ShellActorMessage = ShellExecuteRequest;

export interface ShellWorkerActorState {
  readonly request: ShellExecuteRequest;
}

export interface ShellWorkerStartMessage {
  readonly type: "shellWorkerStart";
}

export type ShellWorkerActorMessage = ShellWorkerStartMessage;

const shellActorShape = defineActorShape({
  kind: "shell",
  state: {},
  messages: {
    shellExecuteRequest: msg({
      requestId: field.string(),
      replyTo: field.ref<{ readonly actorId: string; readonly actorKind: string }>(),
      command: field.string(),
      timeoutSeconds: field.number({ optional: true }),
      cwd: field.string({ optional: true }),
      stdinText: field.string({ optional: true }),
    }),
  },
});

const shellWorkerActorShape = defineActorShape({
  kind: "shellWorker",
  state: {
    request: field.ref<ShellExecuteRequest>(),
  },
  messages: {
    shellWorkerStart: msg({}),
  },
});

export class ShellActor {
  constructor(private readonly support: ShellSubsystemSupport) {}

  buildDefinition(): ActorDefinitionMap<AvenRegistry>[RuntimeActorKind["Shell"]] {
    const { ActorKind } = this.support;
    return buildActorDefinition<AvenRegistry, RuntimeActorKind["Shell"], typeof shellActorShape>(shellActorShape, {
      kind: ActorKind.Shell,
      receive: {
        active: (ctx, rawMessage) => {
          const message = rawMessage as ShellActorMessage;
          if (message.type !== "shellExecuteRequest") {
            return;
          }
          const workerId = ctx.self.id.child(`request~${ctx.envelope.id}`);
          const worker = ctx.spawn(ActorKind.ShellWorker, {
            id: workerId,
            init: { request: message } satisfies ShellWorkerActorState,
          });
          ctx.send(worker as never, { type: "shellWorkerStart" } satisfies ShellWorkerStartMessage as never);
        },
      },
    });
  }

  buildWorkerDefinition(): ActorDefinitionMap<AvenRegistry>[RuntimeActorKind["ShellWorker"]] {
    const { ActorKind } = this.support;
    return buildActorDefinition<AvenRegistry, RuntimeActorKind["ShellWorker"], typeof shellWorkerActorShape>(shellWorkerActorShape, {
      kind: ActorKind.ShellWorker,
      receive: {
        active: async (ctx, rawMessage) => {
          const message = rawMessage as ShellWorkerActorMessage;
          if (message.type !== "shellWorkerStart") {
            return;
          }
          const request = ctx.state.request;
          const sendCompletion = (result: ShellExecuteCompletion["result"]) => {
            ctx.send(
              { id: ActorId.parse(request.replyTo.actorId), kind: request.replyTo.actorKind as never },
              {
                type: "shellExecuteCompleted",
                requestId: request.requestId,
                result,
              } satisfies ShellExecuteCompletion as never,
            );
          };
          try {
            const result = await executeShellCommand(request, {
              config: this.support.config,
              putArtifact: (input) => this.support.storage.putArtifact(input),
              createMetadata: (metadata) => {
                ctx.send({ id: ActorId.parse("/aven/system/metadata"), kind: ActorKind.Metadata }, metadata);
              },
              logError: () => {},
            });
            sendCompletion(result);
          } catch (error) {
            sendCompletion({
              type: "shell.execute.completion",
              exitCode: 1,
              stdoutPreview: "",
              stderrPreview: error instanceof Error ? error.message : "Shell execution failed.",
              stdoutTruncated: false,
              stderrTruncated: false,
              durationMs: 0,
              timedOut: false,
            });
          }
          ctx.stop({ type: StopReasonType.Completed });
        },
      },
    });
  }
}