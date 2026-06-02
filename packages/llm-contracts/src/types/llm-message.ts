import type { LlmInputPart } from "./llm-input-part.ts";

export interface LlmMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: readonly LlmInputPart[];
}