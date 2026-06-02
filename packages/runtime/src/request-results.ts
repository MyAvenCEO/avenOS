import { ActorId, type JsonValue } from "typed-actors";
import type { ErrorDescriptor } from "actor-contracts";
import type { ReplyAddress } from "shared";

export type RequestResult =
  | { readonly type: "ok"; readonly value: JsonValue }
  | { readonly type: "error"; readonly error: ErrorDescriptor };

export interface RequestResultsState {
  readonly resultsByRequestId: Readonly<Record<string, RequestResult>>;
  readonly completedOrder: readonly string[];
  readonly retentionLimit: number;
}

export interface RecordRequestResultMessage {
  readonly type: "recordRequestResult";
  readonly requestId: string;
  readonly result: RequestResult;
}

export type RequestResultsMessage = RecordRequestResultMessage;

export interface RequestResultSender {
  send(target: { readonly id: ActorId; readonly kind: string }, message: RecordRequestResultMessage): void;
}

export function sendRequestResult(
  ctx: RequestResultSender,
  replyTo: ReplyAddress,
  requestId: string,
  result: RequestResult,
): void {
  ctx.send({ id: ActorId.parse(replyTo.actorId), kind: replyTo.actorKind }, {
    type: "recordRequestResult",
    requestId,
    result,
  });
}