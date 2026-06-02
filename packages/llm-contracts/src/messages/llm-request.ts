import type { OptionalReplyableMessage } from "../../../actor-contracts/src/types/actor-message.ts";
import type { SchemaRef } from "schema-contracts";
import type { LlmMessage } from "../types/llm-message.ts";
import type { LlmCapabilityRequirements } from "../types/llm-capability-requirements.ts";
import type { LlmSelectionPolicy } from "../types/llm-selection-policy.ts";

export interface LlmRequest extends OptionalReplyableMessage<"submitLlmRequest"> {
  readonly input: { readonly messages: readonly LlmMessage[] };
  readonly responseSchema?: SchemaRef;
  readonly maxOutputTokens?: number;
  readonly thinking?: "default" | "enabled" | "disabled";
  readonly requirements?: LlmCapabilityRequirements;
  readonly preferredModelActorPath?: string;
  readonly selectionPolicy?: LlmSelectionPolicy;
  readonly callerActorId?: string;
}