export interface LlmUsageMeter {
  readonly callerActorId: string;
  readonly requestCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostUsd: number;
  readonly lastRequestAt?: string;
}