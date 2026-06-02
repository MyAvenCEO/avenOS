import type { ReplyAddress } from "shared";

export interface DismissCommunicationMessage {
  readonly type: "dismissCommunication";
  readonly requestId?: string;
  readonly replyTo?: ReplyAddress;
  readonly communicationId: string;
}