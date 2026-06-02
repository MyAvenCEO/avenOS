import type { JsonObject, JsonValue } from "typed-actors";

/**
 * Casts a record to a JsonObject when the caller already controls the value semantics.
 */
export function toJsonObject(value: Record<string, unknown>): JsonObject {
  return value as JsonObject;
}

/**
 * Builds a JsonObject while dropping undefined entries.
 */
export function jsonObjectEntries(entries: Record<string, JsonValue | undefined>): JsonObject {
  const result: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) result[key] = value;
  }
  return result as JsonObject;
}