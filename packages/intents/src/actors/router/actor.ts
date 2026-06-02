import { ActorId, buildActorDefinition, type ActorContextWithRuntime, type ActorDefinitionMap, type ActorModule, type JsonValue } from "typed-actors";
import { ErrorCategory } from "actor-contracts";
import os from "node:os";
import type { AvenRegistry } from "../../../../runtime/src/spine.ts";
import type {
  HumanReplyMessage,
  IntentActorInit,
  IntentsRouterMessage,
  IntentsRouterState,
  PendingRouteClarification,
  PendingSemanticRouteRequest,
  StartIntentMessage,
} from "../intent/types.ts";
import type { IntentSubsystemSupport } from "../../subsystem.ts";
import { intentsRouterRuntime, intentsRouterShape } from "./shape.ts";
import { sendRequestResult } from "../../../../runtime/src/request-results.ts";
import { toReplyAddress } from "shared";
import { defaultIntentPlannerSettings, defaultIntentToolSettings } from "../intent/runtime-selection.ts";
import type { CreateIntentMessage } from "intents-contracts";
import { buildRouterSystemPrompt, buildRouterUserPrompt, parseRouteDecisionFromLlmOutput, type RouterPromptAttachment } from "./routing-prompt.ts";

type RuntimeActorKind = typeof import("../../../../runtime/src/spine.ts").ActorKind;

export class IntentsRouterActor {
  constructor(private readonly support: IntentSubsystemSupport) {}

  private toPendingToolDefaults(message: Pick<CreateIntentMessage, "toolDefaults">): import("../../domain.ts").IntentToolDefaults | undefined {
    const structuredExtraction = message.toolDefaults?.structuredExtraction;
    if (!structuredExtraction) {
      return undefined;
    }
    return {
      ...(structuredExtraction.requirements === undefined ? {} : { structuredExtractionRequirements: structuredExtraction.requirements }),
      ...(structuredExtraction.modelActorPathOverride === undefined ? {} : { structuredExtractionModelActorPathOverride: structuredExtraction.modelActorPathOverride }),
    };
  }

  private createClarificationCommunication(
    ctx: ActorContextWithRuntime<AvenRegistry, RuntimeActorKind["Intents"], typeof intentsRouterShape.messages, IntentsRouterState>,
    clarificationId: string,
    message: { readonly text: string; readonly attachments?: readonly JsonValue[] },
    clarificationQuestion: string,
    candidates: readonly import("../../domain.ts").IntentRoutingCard[],
  ): string {
    const communicationId = `comm~router~${clarificationId}`;
    ctx.send({ id: ActorId.parse("/aven/system/human"), kind: this.support.ActorKind.Human as never }, {
      type: "createCommunication",
      communicationId,
      kind: "requestInput",
      title: "Where should this go?",
      body: [
        clarificationQuestion,
        "",
        `Message: ${message.text || "(attachments only)"}`,
        "",
        ...(message.attachments?.length
          ? [
              "Attachments:",
              ...message.attachments.map((attachment, index) => {
                const value = attachment as Record<string, JsonValue>;
                const filename = typeof value.filename === "string" ? value.filename : `attachment-${index + 1}`;
                const mime = typeof value.effectiveMimeType === "string" ? value.effectiveMimeType : "unknown";
                return `- ${filename} (${mime})`;
              }),
              "",
            ]
          : []),
        "Choose where to route this message:",
        ...candidates.map((candidate, index) => `${index + 1}. ${candidate.title}`),
      ].join("\n"),
      options: [
        ...candidates.map((candidate) => ({
          optionId: `intent:${candidate.intentId}`,
          label: `Send to ${candidate.title}`,
          value: { decision: "routeToIntent", intentId: candidate.intentId },
        })),
        {
          optionId: "new",
          label: "Start a new intent",
          value: { decision: "createNew" },
        },
        {
          optionId: "discard",
          label: "Discard this message",
          value: { decision: "discard" },
          dangerous: true,
        },
      ],
      routingHint: { routerClarificationId: clarificationId },
      createdBy: ctx.self.id.toString(),
    } as never);
    return communicationId;
  }

  private durableCandidates(state: IntentsRouterState): readonly import("../../domain.ts").IntentRoutingCard[] {
    return Object.values(state.routingCardsByIntentId).filter((card) => (
      card.durable === true
      && card.acceptsExternalInput?.enabled === true
    ));
  }

  private extractPromptAttachments(entries: readonly JsonValue[]): readonly RouterPromptAttachment[] {
    return entries.map((entry) => {
      const value = entry as Record<string, unknown>;
      const ref = value.ref as Record<string, unknown> | undefined;
      return {
        filename: typeof value.filename === "string" ? value.filename : undefined,
        effectiveMimeType: typeof value.effectiveMimeType === "string" ? value.effectiveMimeType : undefined,
        mediaRole: typeof value.mediaRole === "string" ? value.mediaRole : undefined,
        artifactId: typeof ref?.artifactId === "string" ? ref.artifactId : undefined,
      } satisfies RouterPromptAttachment;
    });
  }

  private submitSemanticRouteRequest(
    ctx: ActorContextWithRuntime<AvenRegistry, RuntimeActorKind["Intents"], typeof intentsRouterShape.messages, IntentsRouterState>,
    message: Extract<IntentsRouterMessage, { type: "routeHumanMessage" }>,
    candidates: readonly import("../../domain.ts").IntentRoutingCard[],
  ): void {
    const routeRequestId = `semantic-route~${ctx.state.nextSemanticRouteRequestNumber}`;
    ctx.send({ id: ActorId.parse("/aven/system/llms"), kind: this.support.ActorKind.Llms as never }, {
      type: "submitLlmRequest",
      requestId: routeRequestId,
      replyTo: this.support.clone(toReplyAddress(ctx.self.id, this.support.ActorKind.Intents)),
      responseSchema: { schemaId: "intent_route_decision", version: "1.0.0" },
      requirements: {
        input: { modalities: ["text"] },
        general: { requires: ["structuredOutput"] },
      },
      ...(ctx.state.configuration.runtime?.planner?.modelActorPathOverride
        ? { preferredModelActorPath: ctx.state.configuration.runtime.planner.modelActorPathOverride }
        : {}),
      callerActorId: ctx.self.id.toString(),
      input: {
        messages: [
          {
            role: "system",
            content: [{ kind: "text", text: buildRouterSystemPrompt() }],
          },
          {
            role: "user",
            content: [{
              kind: "text",
              text: buildRouterUserPrompt({
                message: message.message,
                attachments: this.extractPromptAttachments((message.attachments as readonly JsonValue[] | undefined) ?? []),
                candidates,
              }),
            }],
          },
        ],
      },
    } as never);
    const pending: PendingSemanticRouteRequest = {
      routeRequestId,
      originalRequest: {
        ...(message.requestId === undefined ? {} : { requestId: message.requestId }),
        ...(message.replyTo === undefined ? {} : { replyTo: this.support.clone(message.replyTo as unknown as JsonValue) as unknown as { readonly actorId: string; readonly actorKind: string } }),
        message: message.message,
        ...(((message.attachments as readonly JsonValue[] | undefined) ?? []).length === 0
          ? {}
          : { attachments: this.support.clone(((message.attachments as readonly JsonValue[] | undefined) ?? []) as JsonValue) as readonly JsonValue[] }),
        ...(message.plannerRequirements === undefined
          ? {}
          : { plannerRequirements: this.support.clone(message.plannerRequirements as unknown as JsonValue) as typeof message.plannerRequirements }),
        ...(message.plannerModelActorPathOverride === undefined ? {} : { plannerModelActorPathOverride: message.plannerModelActorPathOverride }),
        ...(this.toPendingToolDefaults(message) === undefined
          ? {}
          : { toolDefaults: this.support.clone(this.toPendingToolDefaults(message) as unknown as JsonValue) as import("../../domain.ts").IntentToolDefaults }),
      },
      candidates: candidates.map((candidate) => this.support.clone(candidate as unknown as JsonValue) as unknown as import("../../domain.ts").IntentRoutingCard),
      createdAt: ctx.now.toISOString(),
    };
    ctx.setState(ctx.rt.normalizeState({
      ...ctx.state,
      nextSemanticRouteRequestNumber: ctx.state.nextSemanticRouteRequestNumber + 1,
      pendingSemanticRouteRequestsById: {
        ...ctx.state.pendingSemanticRouteRequestsById,
        [routeRequestId]: pending,
      },
    }));
  }

  private routeHumanMessageToExistingIntent(
    ctx: ActorContextWithRuntime<AvenRegistry, RuntimeActorKind["Intents"], typeof intentsRouterShape.messages, IntentsRouterState>,
    intentId: string,
    message: { readonly requestId?: string; readonly replyTo?: { readonly actorId: string; readonly actorKind: string }; readonly message: string; readonly attachments?: readonly JsonValue[] },
  ): void {
    this.routeOpenIntent(ctx, intentId, {
      source: "humanChat",
      message: message.message,
      attachments: this.support.clone((message.attachments ?? []) as JsonValue),
      routedFrom: {
        type: "globalHumanMessage",
        requestId: message.requestId,
        decision: "matchedExisting",
        routedAt: ctx.now.toISOString(),
      },
    } as JsonValue);
    if (message.requestId && message.replyTo) {
      sendRequestResult(ctx, message.replyTo, message.requestId, {
        type: "ok",
        value: ctx.rt.okResult({ intentId, decision: "matchedExisting" }),
      });
    }
  }

  private routeWaitingIntent(
    ctx: ActorContextWithRuntime<AvenRegistry, RuntimeActorKind["Intents"], typeof intentsRouterShape.messages, IntentsRouterState>,
    intentId: string,
    communicationId: string,
    openQuestionId: string,
    answer: JsonValue,
  ): void {
    const { ActorKind } = this.support;
    ctx.send(
      { id: ctx.self.id.child(intentId), kind: ActorKind.Intent },
      {
        type: "humanReply",
        communicationId,
        answer: this.support.clone(answer),
        openQuestionId,
      } satisfies HumanReplyMessage as never,
    );
  }

  private routeOpenIntent(
    ctx: ActorContextWithRuntime<AvenRegistry, RuntimeActorKind["Intents"], typeof intentsRouterShape.messages, IntentsRouterState>,
    intentId: string,
    input: JsonValue,
  ): void {
    const { ActorKind } = this.support;
    ctx.send(
      { id: ctx.self.id.child(intentId), kind: ActorKind.Intent },
      {
        type: "humanInput",
        input: this.support.clone(input),
      } as never,
    );
  }

  private createIntentFromMessage(
    ctx: ActorContextWithRuntime<AvenRegistry, RuntimeActorKind["Intents"], typeof intentsRouterShape.messages, IntentsRouterState>,
    message: Pick<CreateIntentMessage, "requestId" | "replyTo" | "title" | "goal" | "input" | "plannerRequirements" | "plannerModelActorPathOverride" | "toolDefaults">,
  ): void {
    const { ActorKind } = this.support;
    const intentId = `intent~${ctx.state.nextIntentNumber}`;
    const selected = this.support.selectedModels(message, ctx.state.configuration?.runtime, this.support.intentError as (category: "configuration", message: string, details?: JsonValue) => JsonValue);
    if ("error" in selected) {
      if (message.requestId && message.replyTo) {
        sendRequestResult(ctx, message.replyTo, message.requestId, {
          type: "error",
          error: {
            category: ErrorCategory.Configuration,
            code: "INTENT_MODEL_SELECTION_FAILED",
            message: String((selected.error as { error?: { message?: string } }).error?.message ?? "Failed to select intent models."),
          },
        });
      }
      return;
    }
    const runtime = ctx.state.configuration?.runtime;
    const intentInit: IntentActorInit = {
      intentId,
      title: message.title ?? message.goal,
      goal: message.goal,
      input: this.support.clone((message.input ?? null) as JsonValue),
      shellContext: {
        user: os.userInfo().username,
        home: os.homedir(),
        cwd: process.cwd(),
        platform: process.platform,
      },
      plannerRequirements: selected.plannerRequirements,
      plannerSettings: {
        maxSteps: runtime?.planner?.maxSteps ?? defaultIntentPlannerSettings.maxSteps,
        maxPromptChars: runtime?.planner?.maxPromptChars ?? defaultIntentPlannerSettings.maxPromptChars,
        maxObservationChars: runtime?.planner?.maxObservationChars ?? defaultIntentPlannerSettings.maxObservationChars,
        toolCatalogMode: runtime?.planner?.toolCatalogMode ?? defaultIntentPlannerSettings.toolCatalogMode,
        includeFullSchemaOnValidationError: runtime?.planner?.includeFullSchemaOnValidationError ?? defaultIntentPlannerSettings.includeFullSchemaOnValidationError,
      },
      toolSettings: {
        maxRuns: runtime?.tools?.maxRuns ?? defaultIntentToolSettings.maxRuns,
        artifactReadMaxBytes: runtime?.tools?.artifactReadMaxBytes ?? defaultIntentToolSettings.artifactReadMaxBytes,
        shellInlinePreviewChars: runtime?.tools?.shellInlinePreviewChars ?? defaultIntentToolSettings.shellInlinePreviewChars,
      },
      ...(selected.plannerModelActorPathOverride === undefined ? {} : { plannerModelActorPathOverride: selected.plannerModelActorPathOverride }),
      ...(selected.toolDefaults.structuredExtractionRequirements === undefined
        ? {}
        : { structuredExtractionRequirements: selected.toolDefaults.structuredExtractionRequirements }),
      ...(selected.toolDefaults.structuredExtractionModelActorPathOverride === undefined
        ? {}
        : { structuredExtractionModelActorPathOverride: selected.toolDefaults.structuredExtractionModelActorPathOverride }),
    };
    ctx.spawn(ActorKind.Intent, { id: ctx.self.id.child(intentId), init: intentInit as never });
    ctx.send({ id: ctx.self.id.child(intentId), kind: ActorKind.Intent }, { type: "startIntent" } satisfies StartIntentMessage as never);
    if (message.requestId && message.replyTo) {
      sendRequestResult(ctx, message.replyTo, message.requestId, {
        type: "ok",
        value: ctx.rt.okResult({
          requestId: message.requestId,
          intentId,
          decision: "createdNew",
          plannerRequirements: this.support.clone(selected.plannerRequirements as unknown as JsonValue),
          ...(selected.plannerModelActorPathOverride === undefined ? {} : { plannerModelActorPathOverride: selected.plannerModelActorPathOverride }),
        }),
      });
    }
    ctx.setState(ctx.rt.normalizeState({
      ...ctx.state,
      nextIntentNumber: ctx.state.nextIntentNumber + 1,
      intentIds: [...ctx.state.intentIds, intentId],
      routingCardsByIntentId: {
        ...ctx.state.routingCardsByIntentId,
        [intentId]: {
          intentId,
          status: "created",
          durable: false,
          title: message.title ?? message.goal,
          routingSummary: "Intent created",
          routingVersion: 0,
          updatedAt: ctx.now.toISOString(),
        },
      },
    }));
  }

  buildDefinition(): ActorDefinitionMap<AvenRegistry>[RuntimeActorKind["Intents"]] {
    const { ActorKind } = this.support;
    const definition: ActorModule<AvenRegistry, RuntimeActorKind["Intents"]> = buildActorDefinition<AvenRegistry, RuntimeActorKind["Intents"], typeof intentsRouterShape>(intentsRouterShape, {
      kind: ActorKind.Intents,
      isMessage: intentsRouterRuntime.isMessage,
      init: (input) => {
        return {
          state: {
            nextIntentNumber: 1,
            nextRouteClarificationNumber: 1,
            nextSemanticRouteRequestNumber: 1,
            intentIds: [],
            routingCardsByIntentId: {},
            pendingRouteClarificationsById: {},
            pendingSemanticRouteRequestsById: {},
            configuration: input.runtimeConfig ? { runtime: this.support.clone(input.runtimeConfig) } : {},
          } satisfies IntentsRouterState,
          behavior: "active" as const,
        };
      },
      receive: {
        active: (ctx: ActorContextWithRuntime<AvenRegistry, RuntimeActorKind["Intents"], typeof intentsRouterShape.messages, IntentsRouterState>, message: IntentsRouterMessage) => {
          if (message.type === "configureIntentRuntime") {
            if (ctx.state.configuration?.runtime || ctx.state.intentIds.length > 0) {
              return;
            }
            ctx.setState({
              ...ctx.state,
              configuration: { runtime: this.support.clone(message.runtimeConfig) },
            });
            return;
          }
          if (message.type === "createIntent") {
            this.createIntentFromMessage(ctx, message);
            return;
          }
          if (message.type === "routeHumanMessage") {
            const candidates = this.durableCandidates(ctx.state);
            if (candidates.length > 0) {
              this.submitSemanticRouteRequest(ctx, message, candidates);
              return;
            }
            this.createIntentFromMessage(ctx, {
              requestId: message.requestId,
              replyTo: message.replyTo,
              goal: message.message || "Process attached file(s)",
              input: {
                source: "humanChat",
                message: message.message,
                attachments: this.support.clone((message.attachments ?? []) as JsonValue),
              } as JsonValue,
              plannerRequirements: message.plannerRequirements,
              plannerModelActorPathOverride: message.plannerModelActorPathOverride,
              toolDefaults: message.toolDefaults,
            });
            return;
          }
          if (message.type === "listIntents") {
            return;
          }
          if (message.type === "getRoutingCard") {
            return;
          }
          if (message.type === "humanReplyReceived") {
            const card = ctx.state.routingCardsByIntentId[message.routingHint.intentId ?? ""];
            if (!card) {
              return;
            }
            if (card.openQuestionId !== message.routingHint.openQuestionId) {
              return;
            }
            ctx.send(
              { id: ctx.self.id.child(message.routingHint.intentId!), kind: ActorKind.Intent },
              {
                type: "humanReply",
                communicationId: message.communicationId,
                answer: this.support.clone(message.answer),
                openQuestionId: message.routingHint.openQuestionId!,
              } satisfies HumanReplyMessage as never,
            );
            return;
          }
          if (message.type === "routeClarificationAnswered") {
            const pending = ctx.state.pendingRouteClarificationsById[message.routerClarificationId];
            if (!pending) {
              return;
            }
            const answer = message.answer as Record<string, unknown>;
            const validRoute = answer?.decision === "routeToIntent"
              && typeof answer.intentId === "string"
              && pending.candidates.some((candidate) => candidate.intentId === answer.intentId);
            const validCreateNew = answer?.decision === "createNew" && Object.keys(answer).length === 1;
            const validDiscard = answer?.decision === "discard" && Object.keys(answer).length === 1;
            if (!validRoute && !validCreateNew && !validDiscard) {
              if (pending.originalRequest.requestId && pending.originalRequest.replyTo) {
                sendRequestResult(ctx, pending.originalRequest.replyTo, pending.originalRequest.requestId, {
                  type: "error",
                  error: {
                    category: ErrorCategory.InvalidRequest,
                    code: "ROUTER_CLARIFICATION_INVALID_ANSWER",
                    message: "Router clarification answer must match one of the provided option values.",
                  },
                });
              }
              return;
            }
            const nextPending = { ...ctx.state.pendingRouteClarificationsById };
            delete nextPending[message.routerClarificationId];
            ctx.setState(ctx.rt.normalizeState({ ...ctx.state, pendingRouteClarificationsById: nextPending }));
            if (validRoute) {
              const routedIntentId = answer.intentId as string;
              this.routeOpenIntent(ctx, routedIntentId, {
                source: "humanChat",
                message: pending.originalRequest.message,
                attachments: this.support.clone((pending.originalRequest.attachments ?? []) as JsonValue),
                routedFrom: {
                  type: "globalHumanMessage",
                  requestId: pending.originalRequest.requestId,
                  decision: "matchedExisting",
                  routedAt: ctx.now.toISOString(),
                },
              } as JsonValue);
              return;
            }
            if (validCreateNew) {
              this.createIntentFromMessage(ctx, {
                requestId: pending.originalRequest.requestId,
                replyTo: pending.originalRequest.replyTo,
                goal: pending.originalRequest.message || "Process attached file(s)",
                input: {
                  source: "humanChat",
                  message: pending.originalRequest.message,
                  attachments: this.support.clone((pending.originalRequest.attachments ?? []) as JsonValue),
                } as JsonValue,
                plannerRequirements: pending.originalRequest.plannerRequirements,
                plannerModelActorPathOverride: pending.originalRequest.plannerModelActorPathOverride,
                toolDefaults: pending.originalRequest.toolDefaults as CreateIntentMessage["toolDefaults"],
              });
            }
            return;
          }
          if (message.type === "llmRequestCompleted") {
            const pending = ctx.state.pendingSemanticRouteRequestsById[message.requestId];
            if (!pending) {
              return;
            }
            const nextPending = { ...ctx.state.pendingSemanticRouteRequestsById };
            delete nextPending[message.requestId];
            ctx.setState(ctx.rt.normalizeState({ ...ctx.state, pendingSemanticRouteRequestsById: nextPending }));
            if (message.result.type === "error") {
              if (pending.originalRequest.requestId && pending.originalRequest.replyTo) {
                sendRequestResult(ctx, pending.originalRequest.replyTo, pending.originalRequest.requestId, {
                  type: "error",
                  error: {
                    category: ErrorCategory.OperationFailed,
                    code: "ROUTER_ROUTE_DECISION_FAILED",
                    message: message.result.error.message,
                    ...(message.result.error.details === undefined ? {} : { details: this.support.clone(message.result.error.details) }),
                  },
                });
              }
              return;
            }
            const parsed = parseRouteDecisionFromLlmOutput(message.result.output);
            if (parsed.type === "error") {
              if (pending.originalRequest.requestId && pending.originalRequest.replyTo) {
                sendRequestResult(ctx, pending.originalRequest.replyTo, pending.originalRequest.requestId, {
                  type: "error",
                  error: {
                    category: ErrorCategory.InvalidRequest,
                    code: "ROUTER_ROUTE_DECISION_FAILED",
                    message: parsed.message,
                    ...(parsed.details === undefined ? {} : { details: this.support.clone(parsed.details) }),
                  },
                });
              }
              return;
            }
            const decision = parsed.value;
            if (decision.decision === "routeToIntent") {
              const stillRouteable = this.durableCandidates(ctx.state).find((candidate) => candidate.intentId === decision.intentId);
              if (!stillRouteable || !pending.candidates.some((candidate) => candidate.intentId === decision.intentId)) {
                if (pending.originalRequest.requestId && pending.originalRequest.replyTo) {
                  sendRequestResult(ctx, pending.originalRequest.replyTo, pending.originalRequest.requestId, {
                    type: "error",
                    error: {
                      category: ErrorCategory.InvalidRequest,
                      code: "ROUTER_ROUTE_DECISION_FAILED",
                      message: "Router selected an invalid or no-longer-routable intent.",
                    },
                  });
                }
                return;
              }
              this.routeHumanMessageToExistingIntent(ctx, decision.intentId, pending.originalRequest);
              return;
            }
            if (decision.decision === "createNew") {
              this.createIntentFromMessage(ctx, {
                requestId: pending.originalRequest.requestId,
                replyTo: pending.originalRequest.replyTo,
                goal: pending.originalRequest.message || "Process attached file(s)",
                input: {
                  source: "humanChat",
                  message: pending.originalRequest.message,
                  attachments: this.support.clone((pending.originalRequest.attachments ?? []) as JsonValue),
                } as JsonValue,
                plannerRequirements: pending.originalRequest.plannerRequirements,
                plannerModelActorPathOverride: pending.originalRequest.plannerModelActorPathOverride,
                toolDefaults: pending.originalRequest.toolDefaults as CreateIntentMessage["toolDefaults"],
              });
              return;
            }
            const candidateIds = decision.candidateIntentIds.length > 0
              ? decision.candidateIntentIds
              : pending.candidates.map((candidate) => candidate.intentId);
            const candidates = pending.candidates.filter((candidate) => candidateIds.includes(candidate.intentId));
            const clarificationId = `route-clarification~${ctx.state.nextRouteClarificationNumber}`;
            const communicationId = this.createClarificationCommunication(
              ctx,
              clarificationId,
              { text: pending.originalRequest.message, attachments: pending.originalRequest.attachments ?? [] },
              decision.clarificationQuestion,
              candidates.length > 0 ? candidates : pending.candidates,
            );
            const clarification: PendingRouteClarification = {
              clarificationId,
              originalRequest: this.support.clone(pending.originalRequest as unknown as JsonValue) as unknown as PendingRouteClarification["originalRequest"],
              candidates: (candidates.length > 0 ? candidates : pending.candidates).map((candidate) => this.support.clone(candidate as unknown as JsonValue) as unknown as import("../../domain.ts").IntentRoutingCard),
              createdAt: ctx.now.toISOString(),
            };
            ctx.setState(ctx.rt.normalizeState({
              ...ctx.state,
              nextRouteClarificationNumber: ctx.state.nextRouteClarificationNumber + 1,
              pendingRouteClarificationsById: {
                ...ctx.state.pendingRouteClarificationsById,
                [clarificationId]: clarification,
              },
            }));
            if (pending.originalRequest.requestId && pending.originalRequest.replyTo) {
              sendRequestResult(ctx, pending.originalRequest.replyTo, pending.originalRequest.requestId, {
                type: "ok",
                value: ctx.rt.okResult({
                  decision: "needsClarification",
                  clarificationId,
                  communicationId,
                }),
              });
            }
            return;
          }
          const nextState = ctx.rt.normalizeState({
            ...ctx.state,
            routingCardsByIntentId: {
              ...ctx.state.routingCardsByIntentId,
              [message.routingCard.intentId]: this.support.clone(message.routingCard),
            },
          });
          ctx.setState(nextState);
        },
      },
    });
    return definition;
  }
}
