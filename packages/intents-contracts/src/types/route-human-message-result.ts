import type { JsonValue } from "typed-actors";

export interface RouteCandidateSummary {
  readonly intentId: string;
  readonly title: string;
  readonly status: string;
  readonly score: number;
  readonly reasons: readonly string[];
}

export interface ClassifiedError {
  readonly category: "invalidRequest" | "configuration" | "operationFailed" | "notFound" | "stale";
  readonly code?: string;
  readonly message: string;
  readonly details?: JsonValue;
}

export type RouteHumanMessageResult =
  | {
      readonly type: "ok";
      readonly decision: "createdNew";
      readonly intentId: string;
    }
  | {
      readonly type: "ok";
      readonly decision: "matchedExisting";
      readonly intentId: string;
    }
  | {
      readonly type: "ok";
      readonly decision: "needsClarification";
      readonly clarificationId: string;
      readonly communicationId: string;
      readonly candidates: readonly RouteCandidateSummary[];
    }
  | {
      readonly type: "ok";
      readonly decision: "discarded";
    }
  | {
      readonly type: "error";
      readonly error: ClassifiedError;
    };