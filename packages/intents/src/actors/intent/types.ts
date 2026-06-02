import type { ActorContext, JsonValue } from "typed-actors";
import type {
  ArtifactReadBytesCompleted,
  ArtifactGetDescriptorCompleted,
} from "artifact-contracts";
import type { ShellExecuteCompletion } from "../../../../shell-contracts/src/index.ts";
import type { LlmCapabilityRequirements, LlmRequestCompleted, LlmResult } from "llm-contracts";
import type {
  ConfigureIntentRuntimeMessage,
  CreateIntentMessage,
  GetRoutingCardMessage,
  HumanReplyReceived,
  ListIntentsMessage,
  RouteHumanMessage,
} from "intents-contracts";
import type {
  SchemaValidationCompleted,
  SchemaVersionCompleted,
} from "schema-contracts";
import type { ExtractStructuredCompleted } from "structured-extraction-contracts";
import type { AvenRegistry } from "../../../../runtime/src/spine.ts";
import type {
  IntentNextAction,
  IntentExternalInputRequest,
  IntentObservation,
  IntentPlannerSettings,
  IntentRoutingCard,
  IntentSelectedModels,
  IntentShellContext,
  IntentStatus,
  IntentToolSettings,
  IntentTimelineEvent,
} from "../../domain.ts";

/** Runtime state of the intents router actor that tracks intent ids, routing cards, and configured runtime defaults. */
export interface IntentsRouterState {
  readonly nextIntentNumber: number;
  readonly nextRouteClarificationNumber: number;
  readonly nextSemanticRouteRequestNumber: number;
  readonly intentIds: readonly string[];
  readonly routingCardsByIntentId: Record<string, IntentRoutingCard>;
  readonly pendingRouteClarificationsById: Record<string, PendingRouteClarification>;
  readonly pendingSemanticRouteRequestsById: Record<string, PendingSemanticRouteRequest>;
  readonly configuration: { readonly runtime?: import("../../domain.ts").IntentRuntimeConfig };
}

export interface PendingRouteClarification {
  readonly clarificationId: string;
  readonly originalRequest: {
    readonly requestId?: string;
    readonly replyTo?: { readonly actorId: string; readonly actorKind: string };
    readonly message: string;
    readonly attachments?: readonly JsonValue[];
    readonly plannerRequirements?: import("llm-contracts").LlmCapabilityRequirements;
    readonly plannerModelActorPathOverride?: string;
    readonly toolDefaults?: import("../../domain.ts").IntentToolDefaults;
  };
  readonly candidates: readonly IntentRoutingCard[];
  readonly createdAt: string;
}

export interface PendingSemanticRouteRequest {
  readonly routeRequestId: string;
  readonly originalRequest: {
    readonly requestId?: string;
    readonly replyTo?: { readonly actorId: string; readonly actorKind: string };
    readonly message: string;
    readonly attachments?: readonly JsonValue[];
    readonly plannerRequirements?: LlmCapabilityRequirements;
    readonly plannerModelActorPathOverride?: string;
    readonly toolDefaults?: import("../../domain.ts").IntentToolDefaults;
  };
  readonly candidates: readonly IntentRoutingCard[];
  readonly createdAt: string;
}

/** Runtime state of a single intent actor while planner, tool, and human steps progress. */
export interface IntentActorState {
  readonly intentId: string;
  readonly title: string;
  readonly goal: string;
  readonly input?: JsonValue;
  readonly requiresHumanVisibleResult: boolean;
  readonly durable: boolean;
  readonly externalInputRequest?: IntentExternalInputRequest;
  readonly queuedExternalInputs: readonly JsonValue[];
  readonly status: IntentStatus;
  readonly timeline: readonly IntentTimelineEvent[];
  readonly observations: readonly IntentObservation[];
  readonly openQuestionId?: string;
  readonly openCommunicationId?: string;
  readonly humanAnswers: readonly JsonValue[];
  readonly shellContext: IntentShellContext;
  readonly selectedModels: IntentSelectedModels;
  readonly plannerSettings: IntentPlannerSettings;
  readonly toolSettings: IntentToolSettings;
  readonly currentStep: number;
  readonly cycleStep: number;
  readonly toolRuns: number;
  readonly cycleToolRuns: number;
  readonly activeToolRunId?: string;
  readonly activePlannerRequestId?: string;
  readonly missingHumanResultRetries?: number;
  readonly toolValidationFailureFingerprints?: readonly string[];
}

/** Initialization payload used when spawning a new intent actor. */
export interface IntentActorInit {
  readonly intentId: string;
  readonly title: string;
  readonly goal: string;
  readonly input?: JsonValue;
  readonly plannerRequirements: IntentSelectedModels["plannerRequirements"];
  readonly plannerModelActorPathOverride?: string;
  readonly structuredExtractionRequirements?: IntentSelectedModels["toolDefaults"]["structuredExtractionRequirements"];
  readonly structuredExtractionModelActorPathOverride?: string;
  readonly shellContext: IntentShellContext;
  readonly plannerSettings: IntentPlannerSettings;
  readonly toolSettings: IntentToolSettings;
}

/** Internal message emitted when an intent routing card changes and the router must refresh its index. */
export interface IntentRoutingCardUpdated {
  readonly type: "intentRoutingCardUpdated";
  readonly routingCard: IntentRoutingCard;
}

/** Messages accepted by the intents router actor. */
export type IntentsRouterMessage =
  | CreateIntentMessage
  | RouteHumanMessage
  | ConfigureIntentRuntimeMessage
  | ListIntentsMessage
  | GetRoutingCardMessage
  | HumanReplyReceived
  | RouteClarificationAnsweredMessage
  | LlmRequestCompletedMessage
  | IntentRoutingCardUpdated;

/** Internal message that starts planner-driven execution for a newly spawned intent actor. */
export interface StartIntentMessage {
  readonly type: "startIntent";
}

/** Read-style message requesting the current inspected intent state/result. */
export interface GetIntentMessage {
  readonly type: "getIntent";
}

/** Message requesting that a paused/running intent continue planner execution. */
export interface ContinueIntentMessage {
  readonly type: "continueIntent";
}

/** Routed human reply delivered to a specific intent actor. */
export interface HumanReplyMessage {
  readonly type: "humanReply";
  readonly communicationId: string;
  readonly answer: JsonValue;
  readonly openQuestionId: string;
}

/** Follow-up human input delivered to an intent that intentionally remains open for future messages. */
export interface HumanInputMessage {
  readonly type: "humanInput";
  readonly input: JsonValue;
}

export interface RouteClarificationAnsweredMessage {
  readonly type: "routeClarificationAnswered";
  readonly communicationId: string;
  readonly routerClarificationId: string;
  readonly answer: JsonValue;
}

/** Message requesting cancellation of a running intent. */
export interface CancelIntentMessage {
  readonly type: "cancelIntent";
  readonly reason?: string;
}

/** Planner completion delivered back to an intent actor. */
export interface PlannerCompletedMessage {
  readonly type: "plannerCompleted";
  readonly requestId: string;
  readonly result: LlmResult;
}

/** Tool/planner LLM completion delivered to intents-local actors. */
export interface LlmRequestCompletedMessage extends LlmRequestCompleted {}

/** Completion emitted by a child intent tool-run actor. */
export interface ToolRunCompletedMessage {
  readonly type: "toolRunCompleted";
  readonly runId: string;
  readonly toolId: string;
  readonly input: JsonValue;
  readonly result: JsonValue;
}

/** Messages accepted by an intent actor. */
export type IntentActorMessage =
  | StartIntentMessage
  | GetIntentMessage
  | ContinueIntentMessage
  | HumanReplyMessage
  | HumanInputMessage
  | CancelIntentMessage
  | PlannerCompletedMessage
  | LlmRequestCompletedMessage
  | ToolRunCompletedMessage;

/** Runtime state of a spawned tool-run actor working on behalf of an intent. */
export interface IntentToolRunState {
  readonly runId: string;
  readonly toolId: string;
  readonly input: JsonValue;
  readonly parentIntentId: string;
  readonly artifactReadMaxBytes: number;
  readonly structuredExtractionRequirements?: IntentSelectedModels["toolDefaults"]["structuredExtractionRequirements"];
  readonly structuredExtractionModelActorPathOverride?: string;
  readonly status: "running" | "completed" | "cancelled";
  readonly result?: JsonValue;
}

/** Internal message that begins execution for a spawned tool-run actor. */
export interface StartToolRunMessage {
  readonly type: "startToolRun";
}

/** Metadata create-record completion delivered to a tool-run actor. */
export interface MetadataRecordCompletedMessage {
  readonly type: "metadataRecordCompleted";
  readonly requestId: string;
  readonly result: JsonValue;
}

/** Metadata query completion delivered to a tool-run actor. */
export interface MetadataQueryCompletedMessage {
  readonly type: "metadataQueryCompleted";
  readonly requestId: string;
  readonly result: JsonValue;
}

/** Structured-extraction LLM completion delivered to a tool-run actor. */
export interface StructuredExtractionCompletedMessage extends ExtractStructuredCompleted {}

/** Artifact descriptor completion delivered to a tool-run actor. */
export interface ArtifactDescriptorCompletedMessage extends ArtifactGetDescriptorCompleted {}

/** Artifact byte-range completion delivered to a tool-run actor. */
export interface ArtifactReadBytesCompletedMessage extends ArtifactReadBytesCompleted {}

/** Schema validation completion delivered to a tool-run actor. */
export interface SchemaValidationCompletedMessage extends SchemaValidationCompleted {}

/** Schema version lookup completion delivered to a tool-run actor. */
export interface SchemaVersionCompletedMessage extends SchemaVersionCompleted {}

/** Shell execution completion delivered to a tool-run actor. */
export interface ShellExecuteCompletedMessage extends ShellExecuteCompletion {}

/** Messages accepted by an intent tool-run actor. */
export type IntentToolRunMessage =
  | StartToolRunMessage
  | MetadataRecordCompletedMessage
  | MetadataQueryCompletedMessage
  | StructuredExtractionCompletedMessage
  | ArtifactDescriptorCompletedMessage
  | ArtifactReadBytesCompletedMessage
  | SchemaValidationCompletedMessage
  | SchemaVersionCompletedMessage
  | ShellExecuteCompletedMessage;

export type PreparedToolInputResult =
  | { readonly type: "ok"; readonly input: JsonValue }
  | { readonly type: "error"; readonly message: string; readonly details?: JsonValue };

/** Local tool catalog entry describing an intent-callable tool. */
export type IntentToolDefinition = {
  readonly toolId: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: JsonValue;
  readonly mutates: boolean;
  readonly available: boolean;
  readonly unavailableReason?: string;
  readonly outputDescription: string;
  readonly summarizeObservation: (result: JsonValue) => JsonValue;
  readonly prepareInput?: (args: {
    readonly input: JsonValue;
    readonly intentState: IntentActorState;
    readonly helpers: {
      clone<T>(value: T): T;
    };
  }) => PreparedToolInputResult;
  readonly execute?: (ctx: ActorContext<AvenRegistry, never>, state: IntentToolRunState) => void;
};
