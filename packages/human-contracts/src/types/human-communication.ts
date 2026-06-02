import type { JsonValue } from "typed-actors";
import type { SchemaRef } from "schema-contracts";
import type { HitlOption } from "./hitl-option.ts";
import type { HumanCommunicationKind } from "./human-communication-kind.ts";
import type { HumanCommunicationStatus } from "./human-communication-status.ts";
import type { HumanReplyHint } from "./human-reply-hint.ts";

export interface HumanCommunication {
  readonly communicationId: string;
  readonly kind: HumanCommunicationKind;
  readonly status: HumanCommunicationStatus;
  readonly title: string;
  readonly body: string;
  readonly context?: JsonValue;
  readonly schemaRef?: SchemaRef;
  readonly options?: readonly HitlOption[];
  readonly suggestedOptionId?: string;
  readonly routingHint?: HumanReplyHint;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly answeredAt?: string;
  readonly answer?: JsonValue;
}