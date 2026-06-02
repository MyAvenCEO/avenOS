import { ActorId, StopReasonType, buildActorDefinition, type ActorContextWithRuntime, type ActorDefinitionMap, type ActorModule, type JsonValue } from "typed-actors";
import os from "node:os";
import type { AvenRegistry } from "../../../../runtime/src/spine.ts";
import type { IntentSelectedModels } from "../../domain.ts";
import type { CancelIntentMessage, IntentActorInit, IntentActorMessage, IntentActorState } from "./types.ts";
import type { IntentSubsystemSupport } from "../../subsystem.ts";
import { intentActorRuntime, intentActorShape } from "./shape.ts";
import { applyPlannerCompletion, continueIntentPlanning, resumePlannerAfterExternalInput, resumePlannerAfterHumanReply, resumePlannerAfterToolRun, startIntentPlanning } from "./planner-orchestration.ts";

type RuntimeActorKind = typeof import("../../../../runtime/src/spine.ts").ActorKind;

export class IntentActor {
  constructor(private readonly support: IntentSubsystemSupport) {}

  private toPersistedState(state: IntentActorState): IntentActorState {
    return JSON.parse(JSON.stringify(state)) as IntentActorState;
  }

  private canAcceptQueuedExternalInput(state: IntentActorState): boolean {
    return state.durable === true
      && state.externalInputRequest !== undefined
      && state.status !== "completed"
      && state.status !== "failed"
      && state.status !== "cancelled";
  }

  buildDefinition(): ActorDefinitionMap<AvenRegistry>[RuntimeActorKind["Intent"]] {
    const definition: ActorModule<AvenRegistry, RuntimeActorKind["Intent"]> = buildActorDefinition<AvenRegistry, RuntimeActorKind["Intent"], typeof intentActorShape>(intentActorShape, {
      kind: this.support.ActorKind.Intent,
      init: (input: IntentActorInit) => {
        const selectedModels: IntentSelectedModels = {
          plannerRequirements: input.plannerRequirements,
          ...(input.plannerModelActorPathOverride === undefined ? {} : { plannerModelActorPathOverride: input.plannerModelActorPathOverride }),
          toolDefaults: input.structuredExtractionRequirements || input.structuredExtractionModelActorPathOverride
            ? {
                ...(input.structuredExtractionRequirements === undefined ? {} : { structuredExtractionRequirements: input.structuredExtractionRequirements }),
                ...(input.structuredExtractionModelActorPathOverride === undefined ? {} : { structuredExtractionModelActorPathOverride: input.structuredExtractionModelActorPathOverride }),
              }
            : {},
        };
        return {
          state: {
            intentId: input.intentId,
            title: input.title,
            goal: input.goal,
            ...(input.input === undefined ? {} : { input: this.support.clone(input.input) }),
            requiresHumanVisibleResult: true,
            durable: false,
            queuedExternalInputs: [],
            status: "created",
            timeline: [],
            observations: [],
            humanAnswers: [],
            shellContext: input.shellContext,
            selectedModels,
            plannerSettings: input.plannerSettings,
            toolSettings: input.toolSettings,
            currentStep: 0,
            cycleStep: 0,
            toolRuns: 0,
            cycleToolRuns: 0,
          } satisfies IntentActorState,
          behavior: "active" as const,
        };
      },
      receive: {
        active: (ctx: ActorContextWithRuntime<AvenRegistry, RuntimeActorKind["Intent"], typeof intentActorShape.messages, IntentActorState>, message: IntentActorMessage) => {
          const persistState = (next: IntentActorState) => {
            return ctx.rt.normalizeState(this.toPersistedState(next));
          };
          const maybeDrainQueuedExternalInput = (next: IntentActorState): IntentActorState => {
            if (next.status !== "waitingForExternalInput" || next.queuedExternalInputs.length === 0) {
              return next;
            }
            const [queuedInput, ...rest] = next.queuedExternalInputs;
            if (queuedInput === undefined) {
              return next;
            }
            return resumePlannerAfterExternalInput(
              ctx as never,
              { ...next, queuedExternalInputs: rest },
              queuedInput,
              this.support.plannerReentry,
            );
          };
          const applyState = (next: IntentActorState) => {
            const drained = maybeDrainQueuedExternalInput(next);
            const persisted = this.toPersistedState(drained);
            ctx.setState(persistState(persisted));
            this.support.notifyRouterCard(ctx as never, persisted);
          };
          const applyStateSilently = (next: IntentActorState) => {
            ctx.setState(persistState(next));
          };

          if (message.type === "startIntent") {
            const next = startIntentPlanning(ctx as never, ctx.state, this.support.plannerStartContinue);
            applyState(next);
            return;
          }
          if (message.type === "getIntent") {
            return;
          }
          if (message.type === "continueIntent") {
            const next = continueIntentPlanning(ctx as never, ctx.state, this.support.plannerStartContinue);
            applyState(next);
            return;
          }
          if (message.type === "plannerCompleted" || message.type === "llmRequestCompleted") {
            if (ctx.state.status === "cancelled" || ctx.state.activePlannerRequestId !== message.requestId) {
              return;
            }
            const next = applyPlannerCompletion(ctx as never, ctx.state, message.result, {
              ...this.support.plannerCompletion,
              appendEvent: (state, nowIso, type, summary, data) => this.support.appendEvent(state, nowIso, type, summary, data === undefined ? undefined : this.support.sanitizeJson(data)),
            });
            applyState(next);
            return;
          }
          if (message.type === "toolRunCompleted") {
            if (ctx.state.status === "cancelled") {
              return;
            }
            if (ctx.state.activeToolRunId !== message.runId) {
              applyStateSilently(this.support.appendEvent(ctx.state, ctx.now.toISOString(), "toolIgnoredAsStale", `Ignored stale tool result '${message.runId}'.`, this.support.sanitizeJson(message.result)));
              return;
            }
            const next = resumePlannerAfterToolRun(ctx as never, ctx.state, message, this.support.plannerReentry);
            applyState(next);
            return;
          }
          if (message.type === "humanReply") {
            if (ctx.state.status !== "waitingForHuman" || ctx.state.openQuestionId !== message.openQuestionId || ctx.state.openCommunicationId !== message.communicationId) {
              return;
            }
            const next = resumePlannerAfterHumanReply(ctx as never, ctx.state, message, this.support.plannerReentry);
            applyState(next);
            return;
          }
          if (message.type === "humanInput") {
            if (ctx.state.status === "waitingForExternalInput") {
              const next = resumePlannerAfterExternalInput(ctx as never, ctx.state, message.input, this.support.plannerReentry);
              applyState(next);
              return;
            }
            if (!this.canAcceptQueuedExternalInput(ctx.state)) {
              return;
            }
            const next = this.support.appendObservation(
              this.support.appendEvent(
                {
                  ...ctx.state,
                  queuedExternalInputs: [...ctx.state.queuedExternalInputs, this.support.clone(message.input)],
                },
                ctx.now.toISOString(),
                "humanReplyReceived",
                "Queued follow-up input",
                { answer: message.input, queued: true },
              ),
              ctx.now.toISOString(),
              "humanReply",
              "Queued follow-up input",
              { queued: true, input: message.input },
            );
            applyState(next);
            return;
          }
          const cancelled = this.support.appendEvent(
            { ...ctx.state, status: "cancelled", activePlannerRequestId: undefined, activeToolRunId: undefined, openQuestionId: undefined, openCommunicationId: undefined },
            ctx.now.toISOString(),
            "cancelled",
            (message as CancelIntentMessage).reason ?? "Intent cancelled",
          );
          if (ctx.state.openCommunicationId && !(message.type === "cancelIntent" && (message.reason ?? "").startsWith("Human dismissed communication "))) {
            ctx.send({ id: ActorId.parse("/aven/system/human"), kind: "human" as never }, { type: "dismissCommunication", communicationId: ctx.state.openCommunicationId } as never);
          }
          if (ctx.state.activeToolRunId) {
            ctx.stopChild(
              { id: this.support.activeToolRunActorId(ctx as never, ctx.state.activeToolRunId), kind: this.support.IntentToolRunKind as never },
              { type: StopReasonType.Cancelled },
            );
          }
          applyState(cancelled);
        },
      },
    });
    return definition;
  }
}
