/**
 * Stable severity vocabulary for infrastructure-originated log entries.
 */
export const InfrastructureLogLevel = {
  Debug: "debug",
  Info: "info",
  Warn: "warn",
  Error: "error",
} as const;

/** Shared severity type for infrastructure log entries. */
export type InfrastructureLogLevel = typeof InfrastructureLogLevel[keyof typeof InfrastructureLogLevel];

/**
 * Stable code vocabulary for centralized runtime logging.
 */
export const InfrastructureLogCode = {
  ActivationFailed: "activationFailed",
  SupervisionApplied: "supervisionApplied",
  SchedulerFailed: "schedulerFailed",
  ExternalMessageRejected: "externalMessageRejected",
} as const;

/** Shared code type for infrastructure log entries. */
export type InfrastructureLogCode = typeof InfrastructureLogCode[keyof typeof InfrastructureLogCode];

/**
 * Serializable runtime error shape captured in infrastructure log entries.
 */
export interface InfrastructureLogError {
  /** JavaScript/runtime error name. */
  readonly name: string;
  /** Human-readable error message. */
  readonly message: string;
  /** Optional stack trace when available. */
  readonly stack?: string;
}

/**
 * Public entry stored by the centralized `/aven/system/log` actor.
 */
export interface InfrastructureLogEntry {
  /** Unique log entry id assigned by infrastructure. */
  readonly id: string;
  /** ISO timestamp describing when the event occurred. */
  readonly occurredAt: string;
  /** Stable severity value for operators and tooling. */
  readonly level: InfrastructureLogLevel;
  /** Stable infrastructure event code. */
  readonly code: InfrastructureLogCode;
  /** Human-readable summary describing the event. */
  readonly message: string;
  /** Actor id most directly associated with the event, when applicable. */
  readonly actorId?: string;
  /** Actor kind most directly associated with the event, when applicable. */
  readonly actorKind?: string;
  /** Parent actor id for supervision-related events. */
  readonly parentId?: string;
  /** Child actor id for supervision-related events. */
  readonly childId?: string;
  /** Envelope id involved in the event, when applicable. */
  readonly envelopeId?: string;
  /** Envelope or message type involved in the event, when applicable. */
  readonly messageType?: string;
  /** Supervision directive chosen by infrastructure, when applicable. */
  readonly directive?: string;
  /** Serialized runtime error details, when available. */
  readonly error?: InfrastructureLogError;
}

/**
 * Append-only command consumed by the centralized log actor.
 */
export interface AppendInfrastructureLogMessage {
  /** Stable message discriminator for the log actor mailbox. */
  readonly type: "appendInfrastructureLog";
  /** Fully materialized entry to append to actor state. */
  readonly entry: InfrastructureLogEntry;
}