export interface GetLlmUsageMessage {
  readonly type: "getLlmUsage";
  readonly callerActorId?: string;
}