import type { JsonValue } from "typed-actors";
import type {
  AnswerCommunicationMessage,
  CreateCommunicationMessage,
  DismissCommunicationMessage,
  GetCommunicationMessage,
  HumanCommunication,
  HumanStartedIntentRecord,
  ListCompletedCommunicationsMessage,
  ListOpenCommunicationsMessage,
  RecordStartedIntentMessage,
} from "human-contracts";
import type { SchemaValidationCompleted } from "schema-contracts";

export interface PendingHumanAnswerValidation {
  readonly requestId: string;
  readonly replyTo?: { readonly actorId: string; readonly actorKind: string };
  readonly communicationId: string;
  readonly answer: JsonValue;
}

export interface HumanActorState {
  readonly communicationsById: Readonly<Record<string, HumanCommunication>>;
  readonly openCommunicationIds: readonly string[];
  readonly completedCommunicationIds: readonly string[];
  readonly startedIntents: readonly HumanStartedIntentRecord[];
  readonly nextCommunicationNumber: number;
  readonly pendingAnswerValidationsByRequestId: Readonly<Record<string, PendingHumanAnswerValidation>>;
}

export type HumanActorMessage =
  | CreateCommunicationMessage
  | AnswerCommunicationMessage
  | DismissCommunicationMessage
  | GetCommunicationMessage
  | ListOpenCommunicationsMessage
  | ListCompletedCommunicationsMessage
  | RecordStartedIntentMessage
  | SchemaValidationCompleted;
