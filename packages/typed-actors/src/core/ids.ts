export type Brand<TValue, TBrand extends string> = TValue & { readonly __brand: TBrand };

export type ActorIdString = Brand<string, "ActorIdString">;
export type ActorPathSegment = Brand<string, "ActorPathSegment">;
export type EnvelopeId = Brand<string, "EnvelopeId">;
export type RuntimeEventId = Brand<string, "RuntimeEventId">;
export type RuntimeOwnerId = Brand<string, "RuntimeOwnerId">;
export type IsoDateTimeString = Brand<string, "IsoDateTimeString">;

export type CorrelationId = string;
export type CausationId = string;
export type DedupeKey = string;

export interface IdGenerator {
  envelopeId(): EnvelopeId;
  runtimeEventId(): RuntimeEventId;
  runtimeOwnerId(): RuntimeOwnerId;
}

let counter = 0;

function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

export const defaultIdGenerator: IdGenerator = {
  envelopeId() {
    return nextId("env") as EnvelopeId;
  },
  runtimeEventId() {
    return nextId("evt") as RuntimeEventId;
  },
  runtimeOwnerId() {
    return nextId("owner") as RuntimeOwnerId;
  },
};

export function toIsoDateTimeString(value: Date): IsoDateTimeString {
  return value.toISOString() as IsoDateTimeString;
}