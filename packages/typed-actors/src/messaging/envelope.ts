import type { EnvelopeId, IsoDateTimeString, CorrelationId, CausationId } from "../core/ids.js";
import type { EnvelopeKind } from "../core/constants.js";

export interface EnvelopeView {
  readonly id: EnvelopeId;
  readonly kind: EnvelopeKind;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly correlationId?: CorrelationId;
  readonly causationId?: CausationId;
  readonly createdAt: IsoDateTimeString;
}