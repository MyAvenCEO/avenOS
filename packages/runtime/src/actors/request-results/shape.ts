import { buildActorRuntime, defineActorShape, field, msg, type DerivedActorRuntime } from "typed-actors";
import type { RequestResult, RequestResultsMessage, RequestResultsState } from "../../request-results.ts";

export const requestResultsShape = defineActorShape({
  kind: "requestResults",
  state: {
    resultsByRequestId: field.ref<RequestResultsState["resultsByRequestId"]>({ default: {} as RequestResultsState["resultsByRequestId"] }),
    completedOrder: field.ref<RequestResultsState["completedOrder"]>({ default: [] as RequestResultsState["completedOrder"] }),
    retentionLimit: field.integer({ default: 200 }),
  },
  messages: {
    recordRequestResult: msg({
      requestId: field.string(),
      result: field.ref<RequestResult>(),
    }),
  },
  present(state) {
    return { title: "request-results", subtitle: `${state.completedOrder.length} retained` };
  },
});

export const requestResultsRuntime = buildActorRuntime(requestResultsShape) as DerivedActorRuntime<
  typeof requestResultsShape.messages,
  RequestResultsState
>;

export function isRequestResultsMessage(value: unknown): value is RequestResultsMessage {
  return requestResultsRuntime.isMessage(value);
}