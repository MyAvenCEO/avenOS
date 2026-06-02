import type { ActorIdString, EnvelopeId } from "../../core/ids.js";
import type { ClaimedActivation } from "../../persistence/actor-persistence.js";
import type { SerializedActorError } from "../supervision/supervision-types.js";

export interface ActivationRunner {
  run(claimed: ClaimedActivation): Promise<ActivationRunResult>;
}

export interface ActivationRunCommitted {
  readonly committed: true;
  readonly actorId: ActorIdString;
  readonly envelopeId: EnvelopeId;
}

export interface ActivationRunFailed {
  readonly committed: false;
  readonly actorId: ActorIdString;
  readonly envelopeId: EnvelopeId;
  readonly error: SerializedActorError;
}

export type ActivationRunResult = ActivationRunCommitted | ActivationRunFailed;