export interface DefaultSupervisionPolicyOptions {
  readonly maxRestarts: number;
  readonly windowMs: number;
  readonly retryBackoffMs: number;
}

export const DefaultSupervisionPolicy = {
  MaxRestarts: 3,
  WindowMs: 60_000,
  RetryBackoffMs: 0,
} as const;