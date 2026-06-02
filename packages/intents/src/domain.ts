import type { JsonValue } from "typed-actors";
import type { HumanCommunicationKind } from "human-contracts";
import type { IntentRuntimeConfig as ContractIntentRuntimeConfig } from "intents-contracts";
import type { LlmCapabilityRequirements } from "llm-contracts";

export type IntentStatus =
  | "created"
  | "running"
  | "waitingForTool"
  | "waitingForHuman"
  | "waitingForExternalInput"
  | "completed"
  | "failed"
  | "cancelled";

export type IntentRuntimeConfig = ContractIntentRuntimeConfig;

export interface IntentRuntimeConfigInit {
  readonly runtimeConfig?: IntentRuntimeConfig;
}

export interface IntentShellContext {
  readonly user: string;
  readonly home: string;
  readonly cwd: string;
  readonly platform: NodeJS.Platform;
}

export interface IntentPlannerSettings {
  readonly maxSteps: number;
  readonly maxPromptChars: number;
  readonly maxObservationChars: number;
  readonly toolCatalogMode: "compact" | "full";
  readonly includeFullSchemaOnValidationError: boolean;
}

export interface IntentToolSettings {
  readonly maxRuns: number;
  readonly artifactReadMaxBytes: number;
  readonly shellInlinePreviewChars: number;
}

export interface IntentExternalInputRequest {
  readonly title: string;
  readonly body: string;
  readonly createdAt: string;
  readonly routingDescription: string;
}

export type IntentNextAction =
  | {
      readonly kind: "callTool";
      readonly toolId: string;
      readonly input: JsonValue;
      readonly rationaleSummary?: string;
    }
  | {
      readonly kind: "askHuman";
      readonly title: string;
      readonly body: string;
      readonly rationaleSummary?: string;
    }
  | {
      readonly kind: "notifyHuman";
      readonly communicationKind: Extract<HumanCommunicationKind, "showProgress" | "showWarning" | "showError" | "showBlocked">;
      readonly title: string;
      readonly body: string;
      readonly rationaleSummary?: string;
    }
  | {
      readonly kind: "awaitInput";
      readonly title: string;
      readonly body: string;
      readonly rationaleSummary?: string;
    }
  | {
      readonly kind: "complete";
      readonly result: JsonValue;
      readonly humanResult?: {
        readonly title: string;
        readonly body: string;
      };
      readonly rationaleSummary?: string;
    }
  | {
      readonly kind: "fail";
      readonly reason: string;
      readonly humanError?: {
        readonly title: string;
        readonly body: string;
        readonly communicationKind?: Extract<HumanCommunicationKind, "showError" | "showBlocked">;
      };
      readonly rationaleSummary?: string;
    };

export type ParseResult<T> =
  | { readonly type: "ok"; readonly value: T }
  | { readonly type: "error"; readonly message: string; readonly details?: JsonValue };

export interface IntentRoutingCard {
  readonly intentId: string;
  readonly status: IntentStatus;
  readonly durable: boolean;
  readonly title: string;
  readonly routingSummary: string;
  readonly acceptsExternalInput?: {
    readonly enabled: true;
    readonly title: string;
    readonly body: string;
    readonly routingDescription: string;
  };
  readonly openQuestionId?: string;
  readonly openCommunicationId?: string;
  readonly openQuestionSummary?: string;
  readonly activeToolRunId?: string;
  readonly routingVersion: number;
  readonly updatedAt: string;
}

export interface IntentObservation {
  readonly at: string;
  readonly type:
    | "plannerAction"
    | "toolResult"
    | "humanReply"
    | "communicationRequirement"
    | "error"
    | "status";
  readonly summary: string;
  readonly data?: JsonValue;
}

export interface IntentTimelineEvent {
  readonly eventId: string;
  readonly type:
    | "created"
    | "started"
    | "plannerRequested"
    | "plannerActionAccepted"
    | "toolRequested"
    | "toolCompleted"
    | "toolIgnoredAsStale"
    | "humanQuestionCreated"
    | "awaitingExternalInput"
    | "humanReplyReceived"
    | "completed"
    | "failed"
    | "cancelled"
    | "error";
  readonly createdAt: string;
  readonly summary: string;
  readonly data?: JsonValue;
}

export interface IntentToolDefaults {
  readonly structuredExtractionRequirements?: LlmCapabilityRequirements;
  readonly structuredExtractionModelActorPathOverride?: string;
}

export interface IntentSelectedModels {
  readonly plannerRequirements: LlmCapabilityRequirements;
  readonly plannerModelActorPathOverride?: string;
  readonly toolDefaults: {
    readonly structuredExtractionRequirements?: LlmCapabilityRequirements;
    readonly structuredExtractionModelActorPathOverride?: string;
  };
}

export type {
  MetadataQueryFilter,
  MetadataQueryRecordsInput,
  MetadataQueryRecordsOutput,
} from "metadata-contracts";

export const intentNextActionSchemaId = "intent_next_action";
export const intentNextActionSchemaVersion = "1.0.0";
