import type { LlmProviderProtocol } from "llm-contracts";
import { createOpenAiChatCompletionsAdapter } from "./openai/chat-completions-adapter.ts";
import { createOpenAiResponsesAdapter } from "./openai/responses-adapter.ts";
import { createOpenAiCompatibleChatCompletionsAdapter } from "./openai-compatible/chat-completions-adapter.ts";
import type { LlmProviderAdapter } from "./types.ts";

const adapters = {
  "openai.responses": createOpenAiResponsesAdapter(),
  "openai.chat-completions": createOpenAiChatCompletionsAdapter(),
  "openai-compatible.chat-completions": createOpenAiCompatibleChatCompletionsAdapter(),
} satisfies Record<LlmProviderProtocol, LlmProviderAdapter<unknown>>;

export function adapterForProtocol(protocol: LlmProviderProtocol): LlmProviderAdapter<unknown> {
  return adapters[protocol];
}

export * from "./types.ts";