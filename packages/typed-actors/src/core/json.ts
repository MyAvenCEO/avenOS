import { ActorErrorCode } from "./constants.js";
import { InvalidJsonValueError } from "./errors.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonArray = readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (Object.prototype.toString.call(value) !== "[object Object]") {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function innerIsJsonValue(value: unknown, seen: WeakSet<object>): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (
    typeof value === "undefined" ||
    typeof value === "bigint" ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    return false;
  }

  if (value instanceof Date || value instanceof Map || value instanceof Set) {
    return false;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return value.every((entry) => innerIsJsonValue(entry, seen));
  }

  if (!isPlainObject(value)) {
    return false;
  }

  if (seen.has(value)) {
    return false;
  }

  seen.add(value);
  return Object.values(value).every((entry) => innerIsJsonValue(entry, seen));
}

export function isJsonValue(value: unknown): value is JsonValue {
  return innerIsJsonValue(value, new WeakSet<object>());
}

export function assertJsonValue(value: unknown): asserts value is JsonValue {
  if (!isJsonValue(value)) {
    throw new InvalidJsonValueError(ActorErrorCode.InvalidJsonValue, "Value is not JSON-compatible");
  }
}

export function cloneJson<T extends JsonValue>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => cloneJson(entry)) as unknown as T;
  }
  const result: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      result[key] = cloneJson(entry as JsonValue);
    }
  }
  return result as T;
}

export function canonicalizeJson(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeJson(entry));
  }
  const objectValue = value as JsonObject;
  const sortedKeys = Object.keys(objectValue).sort();
  const result: Record<string, JsonValue> = {};
  for (const key of sortedKeys) {
    result[key] = canonicalizeJson(objectValue[key]!);
  }
  return result;
}

export function canonicalJsonString(value: JsonValue): string {
  return JSON.stringify(canonicalizeJson(value));
}