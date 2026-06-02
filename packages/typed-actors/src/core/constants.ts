export type ValueOf<T> = T[keyof T];

export const ActorStatus = {
  Starting: "starting",
  Running: "running",
  Suspended: "suspended",
  Stopping: "stopping",
  Stopped: "stopped",
} as const;

export type ActorStatus = ValueOf<typeof ActorStatus>;

export const EnvelopeKind = {
  User: "user",
  LifecycleStart: "lifecycle.start",
  LifecycleStop: "lifecycle.stop",
  LifecycleRestart: "lifecycle.restart",
  Supervision: "supervision",
} as const;

export type EnvelopeKind = ValueOf<typeof EnvelopeKind>;

export const EnvelopeStatus = {
  Queued: "queued",
  Processing: "processing",
  Completed: "completed",
  Faulted: "faulted",
  DeadLettered: "deadLettered",
  Dropped: "dropped",
} as const;

export type EnvelopeStatus = ValueOf<typeof EnvelopeStatus>;

export const SystemMessageType = {
  LifecycleStart: "system.lifecycle.start",
  LifecycleStop: "system.lifecycle.stop",
  LifecycleRestart: "system.lifecycle.restart",
  Supervision: "system.supervision",
} as const;

export type SystemMessageType = ValueOf<typeof SystemMessageType>;

export const SupervisionDirectiveType = {
  Resume: "resume",
  Restart: "restart",
  Stop: "stop",
  Escalate: "escalate",
} as const;

export type SupervisionDirectiveType = ValueOf<typeof SupervisionDirectiveType>;

export const FailedMessageAction = {
  Drop: "drop",
  Retry: "retry",
  DeadLetter: "deadLetter",
} as const;

export type FailedMessageAction = ValueOf<typeof FailedMessageAction>;

export const StopReasonType = {
  Requested: "requested",
  Completed: "completed",
  Cancelled: "cancelled",
  Supervision: "supervision",
  ParentStopped: "parentStopped",
  RuntimeShutdown: "runtimeShutdown",
} as const;

export type StopReasonType = ValueOf<typeof StopReasonType>;

export const RestartReasonType = {
  Supervision: "supervision",
  Manual: "manual",
} as const;

export type RestartReasonType = ValueOf<typeof RestartReasonType>;

export const RuntimeEventType = {
  ActorCreated: "actor.created",
  ActorStatusChanged: "actor.statusChanged",
  EnvelopeCreated: "envelope.created",
  EnvelopeStatusChanged: "envelope.statusChanged",
  ActivationFailed: "activation.failed",
  SupervisionApplied: "supervision.applied",
} as const;

export type RuntimeEventType = ValueOf<typeof RuntimeEventType>;

export const InspectionEventType = {
  SnapshotInvalidated: "inspection.snapshotInvalidated",
} as const;

export type InspectionEventType = ValueOf<typeof InspectionEventType>;

export const SnapshotInvalidationReason = {
  ActivationCommitted: "activationCommitted",
  ActivationFailed: "activationFailed",
  RuntimeChanged: "runtimeChanged",
  Manual: "manual",
} as const;

export type SnapshotInvalidationReason = ValueOf<typeof SnapshotInvalidationReason>;

export const ActorErrorCode = {
  ActorNotFound: "ActorNotFound",
  SpawnConflict: "SpawnConflict",
  InvalidChildIdentity: "InvalidChildIdentity",
  InvalidBehavior: "InvalidBehavior",
  InvalidJsonValue: "InvalidJsonValue",
  PersistenceConflict: "PersistenceConflict",
  EnvelopeLeaseMismatch: "EnvelopeLeaseMismatch",
  UnhandledMessage: "UnhandledMessage",
  RuntimeStopped: "RuntimeStopped",
} as const;

export type ActorErrorCode = ValueOf<typeof ActorErrorCode>;