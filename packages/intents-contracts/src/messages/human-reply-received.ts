import type { JsonValue } from "typed-actors";
import type { HumanReplyHint } from "human-contracts";

export interface HumanReplyReceived {
  readonly type: "humanReplyReceived";
  readonly communicationId: string;
  readonly answer: JsonValue;
  readonly routingHint: HumanReplyHint;
}