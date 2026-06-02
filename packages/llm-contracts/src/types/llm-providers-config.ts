import type { ConfiguredLlmProvider } from "./configured-llm-provider.ts";

export interface LlmProvidersConfig {
  readonly version: 1;
  readonly defaults?: {
    readonly maxParallel?: number;
    readonly maxQueue?: number;
    readonly requestTimeoutMs?: number;
    readonly maxOutputTokens?: number;
    readonly retentionMaxCompleted?: number;
    readonly retentionMaxInlineResultBytes?: number;
  };
  readonly providers: readonly ConfiguredLlmProvider[];
}