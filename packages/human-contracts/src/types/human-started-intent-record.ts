import type { JsonValue } from "typed-actors";

export interface HumanStartedIntentRecord {
  readonly intentId: string;
  readonly decision: "createdNew" | "matchedExisting";
  readonly message: string;
  readonly attachmentRefs: ReadonlyArray<{
    readonly filename: string;
    readonly mediaRole: string;
    readonly ref: JsonValue;
  }>;
  readonly createdAt: string;
}