import type { ActorContext, JsonValue } from "typed-actors";
import type { AvenRegistry } from "../../../../runtime/src/spine.ts";
import type { ProviderRuntime } from "../../runtime-support.ts";
import type { BuildLlmSubsystemOptions, LlmRequestWorkerMessage, LlmRequestWorkerState } from "../llms/types.ts";
import { clone } from "../../support.ts";
import { processProviderRequest } from "./provider-execution.ts";
import { mapClientError, sendValidationRequest, validateCompletedToResult, workerComplete } from "./support.ts";
import { pendingAsyncResult } from "../model/lifecycle.ts";
import { getBundledSchemaBinding } from "schema";

export function createLlmWorkerHelpers(args: {
  readonly registry: AvenRegistry;
  readonly ActorKind: typeof import("../../../../runtime/src/spine.ts").ActorKind;
  readonly providerRuntimes: Record<string, ProviderRuntime>;
  readonly artifactStorage?: BuildLlmSubsystemOptions["artifactStorage"];
}) {
  const { registry, ActorKind, providerRuntimes, artifactStorage } = args;

  const workerHelpers = {
    processProviderRequest: (
      ctx: ActorContext<typeof registry, typeof ActorKind.LlmRequestWorker>,
    ) => {
      const runtime = providerRuntimes[ctx.state.providerId];
      return processProviderRequest(
        ctx,
        runtime?.client,
        runtime?.authError,
        artifactStorage,
        {
          mapClientError,
          workerComplete,
          sendValidationRequest,
          resolveStructuredOutputSchema(schemaRef) {
            return getBundledSchemaBinding(schemaRef)?.definition.schema;
          },
        },
      );
    },
    pendingAsyncResult,
    withGetResultOperationResult: (state: LlmRequestWorkerState) => state,
    validatedStructuredOutputResult: (state: LlmRequestWorkerState) => ({
      type: "ok" as const,
      requestId: state.requestId,
      output: [{ kind: "json" as const, value: clone(state.pendingStructuredOutput ?? null) }],
      usage: {
        providerId: state.providerId,
        model: state.modelId,
        validated: true as const,
        schemaRef: clone(state.request.responseSchema as unknown as JsonValue),
      },
    }),
    handleMessage: async (
      ctx: ActorContext<typeof registry, typeof ActorKind.LlmRequestWorker>,
      message: LlmRequestWorkerMessage,
    ) => {
      if (message.type === "getResult") {
        ctx.setState(clone(workerHelpers.withGetResultOperationResult(ctx.state)));
        return true;
      }
      if (message.type === "beginProcessing") {
        await workerHelpers.processProviderRequest(ctx);
        return true;
      }
      if (message.requestId !== ctx.state.requestId) {
        return true;
      }
      if (message.result.type === "ok") {
        workerHelpers.workerComplete(ctx, workerHelpers.validatedStructuredOutputResult(ctx.state));
        return true;
      }
      workerHelpers.workerComplete(
        ctx,
        workerHelpers.validateCompletedToResult(
          ctx.state.requestId,
          message.result,
          clone(ctx.state.pendingStructuredOutput),
        ),
      );
      return true;
    },
    workerComplete,
    validateCompletedToResult,
  };

  return workerHelpers;
}