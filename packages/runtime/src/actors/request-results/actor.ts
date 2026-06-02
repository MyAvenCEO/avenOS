import { buildActorDefinition, type ActorDefinitionMap, type ActorModule, type JsonValue } from "typed-actors";
import type { AvenRegistry } from "../../spine.ts";
import { ActorKind } from "../../spine.ts";
import { requestResultsRuntime, requestResultsShape } from "./shape.ts";
import type { RequestResult, RequestResultsMessage, RequestResultsState } from "../../request-results.ts";

type RuntimeActorKind = typeof import("../../spine.ts").ActorKind;

const DEFAULT_RETENTION_LIMIT = 200;

export class RequestResultsActor {
  buildDefinition(): ActorDefinitionMap<AvenRegistry>[RuntimeActorKind["RequestResults"]] {
    const definition: ActorModule<AvenRegistry, RuntimeActorKind["RequestResults"]> = buildActorDefinition<AvenRegistry, RuntimeActorKind["RequestResults"], typeof requestResultsShape>(requestResultsShape, {
      kind: ActorKind.RequestResults,
      init: () => ({
        state: {
          resultsByRequestId: {},
          completedOrder: [],
          retentionLimit: DEFAULT_RETENTION_LIMIT,
        } satisfies RequestResultsState,
        behavior: "active" as const,
      }),
      receive: {
        active: (ctx, message: RequestResultsMessage) => {
          if (message.type !== "recordRequestResult") {
            return;
          }
          const nextResults: Record<string, RequestResult> = {
            ...ctx.state.resultsByRequestId,
            [message.requestId]: message.result,
          };
          const nextOrder = [...ctx.state.completedOrder.filter((id) => id !== message.requestId), message.requestId];
          while (nextOrder.length > ctx.state.retentionLimit) {
            const evicted = nextOrder.shift();
            if (evicted) {
              delete nextResults[evicted];
            }
          }
          ctx.setState({
            ...ctx.state,
            resultsByRequestId: nextResults,
            completedOrder: nextOrder,
          });
        },
      },
    });
    return definition;
  }
}