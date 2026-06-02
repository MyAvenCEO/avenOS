import type { LlmResult } from "../types/llm-result.ts";

export interface LlmRequestCompleted {
  readonly type: "llmRequestCompleted";
  readonly requestId: string;
  readonly result: LlmResult;
}