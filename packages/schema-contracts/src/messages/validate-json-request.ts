import type { ReplyableMessage } from "../../../actor-contracts/src/types/actor-message.ts";
import type { SchemaRef } from "../types/schema-ref.ts";

export interface ValidateJsonRequest extends ReplyableMessage<"validateJsonRequest"> {
  readonly type: "validateJsonRequest";
  readonly schemaRef: SchemaRef;
  readonly value: unknown;
}