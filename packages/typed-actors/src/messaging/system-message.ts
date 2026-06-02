import { SystemMessageType } from "../core/constants.js";
import type { ActorFailure } from "../runtime/supervision/supervision-types.js";
import type { RestartReason, StopReason } from "../runtime/lifecycle/lifecycle-types.js";

export interface LifecycleStartSystemMessage {
  readonly type: typeof SystemMessageType.LifecycleStart;
}

export interface LifecycleStopSystemMessage {
  readonly type: typeof SystemMessageType.LifecycleStop;
  readonly reason: StopReason;
}

export interface LifecycleRestartSystemMessage {
  readonly type: typeof SystemMessageType.LifecycleRestart;
  readonly reason: RestartReason;
}

export interface SupervisionSystemMessage {
  readonly type: typeof SystemMessageType.Supervision;
  readonly failure: ActorFailure;
}

export type SystemMessage =
  | LifecycleStartSystemMessage
  | LifecycleStopSystemMessage
  | LifecycleRestartSystemMessage
  | SupervisionSystemMessage;