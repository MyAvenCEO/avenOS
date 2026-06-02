import type { ActorContext } from "typed-actors";
import type { AvenRegistry } from "../../../../runtime/src/spine.ts";
import { describeCapabilitiesResult, listRequestsResult } from "../../results.ts";
import type { LlmModelMessage, LlmModelState } from "../llms/types.ts";
import { validateLlmInputAgainstCapabilities } from "../model/capability-validation.ts";
import { clone } from "../../support.ts";
import { completeRequest, submitRequest } from "../model/lifecycle.ts";

export function createLlmModelHelpers(args: {
  readonly registry: AvenRegistry;
  readonly ActorKind: typeof import("../../../../runtime/src/spine.ts").ActorKind;
}) {
  const { registry, ActorKind } = args;

  const modelHelpers = {
    submitRequest: (
      ctx: ActorContext<typeof registry, typeof ActorKind.LlmModel>,
      state: LlmModelState,
      message: Extract<LlmModelMessage, { readonly type: "submitLlmRequest" }>,
    ) => submitRequest(
      ctx,
      ActorKind.LlmRequestWorker,
      state,
      { ...message, maxOutputTokens: message.maxOutputTokens ?? state.defaultMaxOutputTokens },
      validateLlmInputAgainstCapabilities,
    ),
    withListRequestsOperationResult: (state: LlmModelState) => state,
    withDescribeCapabilitiesOperationResult: (state: LlmModelState) => state,
    refreshModelConfig: (
      state: LlmModelState,
      message: Extract<LlmModelMessage, { readonly type: "refreshModelConfig" }>,
    ): LlmModelState => ({
      ...state,
      providerTitle: message.providerTitle,
      providerProtocol: message.providerProtocol,
      providerBaseUrl: message.providerBaseUrl,
      configId: message.configId,
      title: message.title,
      capabilities: clone(message.capabilities),
      pricing: message.pricing,
      maxParallel: message.maxParallel,
      maxQueue: message.maxQueue,
      defaultMaxOutputTokens: message.defaultMaxOutputTokens,
      available: message.available,
      lastSeenAt: message.lastSeenAt,
    }),
    withValidateLlmInputOperationResult: (
      state: LlmModelState,
      message: Extract<LlmModelMessage, { readonly type: "validateLlmInput" }>,
    ) => state,
    completeRequest: (
      ctx: ActorContext<typeof registry, typeof ActorKind.LlmModel>,
      state: LlmModelState,
      message: Extract<LlmModelMessage, { readonly type: "requestCompleted" }>,
    ) => completeRequest(ctx, ActorKind.LlmRequestWorker, state, message),
    handleMessage: (
      ctx: ActorContext<typeof registry, typeof ActorKind.LlmModel>,
      message: LlmModelMessage,
    ) => {
      if (message.type === "submitLlmRequest") {
        ctx.setState(clone(modelHelpers.submitRequest(ctx, ctx.state, message)));
        return true;
      }
      if (message.type === "listRequests") {
        ctx.setState(clone(modelHelpers.withListRequestsOperationResult(ctx.state)));
        return true;
      }
      if (message.type === "describeCapabilities") {
        ctx.setState(clone(modelHelpers.withDescribeCapabilitiesOperationResult(ctx.state)));
        return true;
      }
      if (message.type === "refreshModelConfig") {
        ctx.setState(clone(modelHelpers.refreshModelConfig(ctx.state, message)));
        return true;
      }
      if (message.type === "validateLlmInput") {
        ctx.setState(clone(modelHelpers.withValidateLlmInputOperationResult(ctx.state, message)));
        return true;
      }
      if (message.type === "requestCompleted") {
        ctx.setState(clone(modelHelpers.completeRequest(ctx, ctx.state, message)));
        return true;
      }
      return false;
    },
  };

  return modelHelpers;
}