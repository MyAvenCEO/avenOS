import type { JsonValue } from "typed-actors";
import type { ReplyAddress } from "shared";

export interface AnswerCommunicationMessage {
  readonly type: "answerCommunication";
  readonly requestId?: string;
  readonly replyTo?: ReplyAddress;
  readonly communicationId: string;
  readonly answer: JsonValue;
}