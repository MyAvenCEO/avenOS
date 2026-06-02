import type { SchemaRef } from "schema-contracts";
import type { LlmMessage } from "../types/llm-message.ts";

export interface ValidateLlmInputMessage {
  readonly type: "validateLlmInput";
  readonly input: { readonly messages: readonly LlmMessage[] };
  readonly thinking?: "default" | "enabled" | "disabled";
  readonly responseSchema?: SchemaRef;
  readonly maxOutputTokens?: number;
}