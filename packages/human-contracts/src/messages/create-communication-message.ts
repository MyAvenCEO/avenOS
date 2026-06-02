import type { JsonValue } from "typed-actors";
import type { SchemaRef } from "schema-contracts";
import type { HitlOption } from "../types/hitl-option.ts";
import type { HumanCommunicationKind } from "../types/human-communication-kind.ts";
import type { HumanReplyHint } from "../types/human-reply-hint.ts";

export interface CreateCommunicationMessage {
  readonly type: "createCommunication";
  readonly communicationId?: string;
  readonly kind: HumanCommunicationKind;
  readonly title: string;
  readonly body: string;
  readonly context?: JsonValue;
  readonly schemaRef?: SchemaRef;
  readonly options?: readonly HitlOption[];
  readonly suggestedOptionId?: string;
  readonly routingHint?: HumanReplyHint;
  readonly createdBy?: string;
}