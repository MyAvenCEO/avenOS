import {
  FailedMessageAction,
  SupervisionDirectiveType,
} from "../../core/constants.js";
import type { EnvelopeKind } from "../../core/constants.js";
import type { ActorIdString, EnvelopeId, IsoDateTimeString } from "../../core/ids.js";

export interface FailedActorInfo {
  readonly id: ActorIdString;
  readonly kind: string;
  readonly generation: number;
}

export interface FailedEnvelopeInfo {
  readonly id: EnvelopeId;
  readonly kind: EnvelopeKind;
  readonly messageType: string;
  readonly attempt: number;
  readonly maxAttempts: number;
}

export interface SerializedActorError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly retryable?: boolean;
}

export interface ActorFailure {
  readonly child: FailedActorInfo;
  readonly envelope: FailedEnvelopeInfo;
  readonly error: SerializedActorError;
  readonly occurredAt: IsoDateTimeString;
}

export interface ResumeDirective {
  readonly type: typeof SupervisionDirectiveType.Resume;
  readonly failedMessage:
    | typeof FailedMessageAction.Drop
    | typeof FailedMessageAction.Retry;
  readonly backoffMs?: number;
}

export interface RestartDirective {
  readonly type: typeof SupervisionDirectiveType.Restart;
  readonly failedMessage:
    | typeof FailedMessageAction.Drop
    | typeof FailedMessageAction.Retry;
  readonly backoffMs?: number;
}

export interface StopDirective {
  readonly type: typeof SupervisionDirectiveType.Stop;
  readonly failedMessage:
    | typeof FailedMessageAction.DeadLetter
    | typeof FailedMessageAction.Drop;
}

export interface EscalateDirective {
  readonly type: typeof SupervisionDirectiveType.Escalate;
}

export type SupervisionDirective =
  | ResumeDirective
  | RestartDirective
  | StopDirective
  | EscalateDirective;