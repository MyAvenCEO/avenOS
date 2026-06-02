import { ActorId, type ActorContext, type JsonObject, type JsonValue } from "typed-actors";
import type { ReplyAddress } from "shared";
import {
  cloneJsonValue as sharedCloneJsonValue,
  isJsonObject as sharedIsJsonObject,
  jsonObjectEntries as sharedJsonObjectEntries,
  toJsonObject as sharedToJsonObject,
} from "shared";
import {
  compareSchemaVersions,
  hashSchema,
  schemaError,
  toSchemaRef,
  type RegisteredSchemaVersion,
  type SchemaValidationResult,
} from "../../domain.ts";
import { type SchemaValidationService } from "../schema/validation-service.ts";
import type {
  RegisterSchemaVersionMessage,
  SchemaActorState,
  SchemaValidationCompleted,
  SchemaVersionCompleted,
} from "./types.ts";

export function cloneJsonValue<T>(value: T): T {
  return sharedCloneJsonValue(value);
}

export const isJsonObject = sharedIsJsonObject;

export function toJsonObject(value: Record<string, unknown>): JsonObject {
  return sharedToJsonObject(value);
}

export function jsonObjectEntries(entries: Record<string, JsonValue | undefined>): JsonObject {
  return sharedJsonObjectEntries(entries);
}

export function exampleFromSchema(schema: JsonValue): JsonValue {
  if (!isJsonObject(schema)) return null;
  if ("default" in schema) return cloneJsonValue(schema.default as JsonValue);
  if ("example" in schema) return cloneJsonValue(schema.example as JsonValue);
  if (Array.isArray(schema.examples) && schema.examples.length > 0) return cloneJsonValue(schema.examples[0] as JsonValue);
  if ("const" in schema) return cloneJsonValue(schema.const as JsonValue);
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return cloneJsonValue(schema.enum[0] as JsonValue);

  const schemaType = typeof schema.type === "string" ? schema.type : undefined;
  if (schemaType === "object" || isJsonObject(schema.properties)) {
    const properties = isJsonObject(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === "string")
      : [];
    const keys = required.length > 0 ? required : Object.keys(properties);
    const result: Record<string, JsonValue> = {};
    for (const key of keys) {
      const propertySchema = properties[key];
      if (propertySchema !== undefined) result[key] = exampleFromSchema(propertySchema as JsonValue);
    }
    return result;
  }
  if (schemaType === "array") {
    if (schema.items !== undefined) return [exampleFromSchema(schema.items as JsonValue)];
    return [];
  }
  if (schemaType === "string") return "example";
  if (schemaType === "number" || schemaType === "integer") return 0;
  if (schemaType === "boolean") return true;
  return null;
}

export function schemaRefSummaryValue(registered: RegisteredSchemaVersion): JsonValue {
  return toJsonObject({
    schemaId: registered.schemaRef.schemaId,
    version: registered.schemaRef.version,
  });
}

export function schemaVersionToJson(registered: RegisteredSchemaVersion): JsonObject {
  return jsonObjectEntries({
    schemaRef: schemaRefSummaryValue(registered),
    schemaHash: registered.schemaHash,
    registeredAt: registered.registeredAt,
    schema: cloneJsonValue(registered.schema) as JsonValue,
  });
}

export function resolveLatest(state: SchemaActorState): SchemaValidationResult {
  if (!state.latestVersion) {
    return schemaError({ schemaId: state.schemaId }, "schemaNotFound", "SCHEMA_VERSION_NOT_FOUND", `No versions exist for schema '${state.schemaId}'.`);
  }
  const version = state.versions[state.latestVersion];
  if (!version) {
    return schemaError({ schemaId: state.schemaId }, "schemaNotFound", "SCHEMA_VERSION_NOT_FOUND", `Version '${state.latestVersion}' was not found.`);
  }
  return { type: "ok", schemaRef: version.schemaRef, schemaHash: version.schemaHash };
}

export function validatePinned(state: SchemaActorState, service: SchemaValidationService, version: string, value: JsonValue): SchemaValidationResult {
  const schemaRef = toSchemaRef(state.schemaId, version);
  const registered = state.versions[version];
  if (!registered) {
    return schemaError(schemaRef, "schemaNotFound", "SCHEMA_VERSION_NOT_FOUND", `Schema '${state.schemaId}@${version}' was not found.`);
  }
  return service.validateValue(registered, value);
}

export function sendSchemaValidationCompleted(
  ctx: ActorContext<any, any>,
  requestId: string,
  replyTo: ReplyAddress,
  result: SchemaValidationResult,
) {
  const reply: SchemaValidationCompleted = {
    type: "schemaValidationCompleted",
    requestId,
    result,
  };
  ctx.send({ id: ActorId.parse(replyTo.actorId), kind: replyTo.actorKind as never }, reply as never);
}

export function sendSchemaVersionCompleted(
  ctx: ActorContext<any, any>,
  requestId: string,
  replyTo: ReplyAddress,
  result: SchemaVersionCompleted["result"],
) {
  const reply: SchemaVersionCompleted = {
    type: "schemaVersionCompleted",
    requestId,
    result,
  };
  ctx.send({ id: ActorId.parse(replyTo.actorId), kind: replyTo.actorKind as never }, reply as never);
}

export function registerVersion(
  state: SchemaActorState,
  service: SchemaValidationService,
  now: Date,
  message: RegisterSchemaVersionMessage,
): SchemaActorState {
  if (message.schemaId !== state.schemaId) {
    return state;
  }
  const schemaRef = toSchemaRef(message.schemaId, message.version);
  const storedSchema = cloneJsonValue(message.schema) as JsonValue;
  const validation = service.validateSchemaDocument(schemaRef, cloneJsonValue(message.schema) as JsonValue);
  if (validation.type === "error") {
    return state;
  }
  const existing = state.versions[message.version];
  const schemaHash = hashSchema(storedSchema);
  if (existing) {
    if (existing.schemaHash === schemaHash) {
      return state;
    }
    return state;
  }

  const registered: RegisteredSchemaVersion = {
    schemaRef,
    schemaHash,
    schema: storedSchema,
    registeredAt: now.toISOString(),
  };
  const latestVersion = state.latestVersion === undefined || compareSchemaVersions(message.version, state.latestVersion) > 0
    ? message.version
    : state.latestVersion;
  return {
    ...state,
    latestVersion,
    versions: { ...state.versions, [message.version]: registered },
  };
}

export function rejectSchemaIdMismatch(state: SchemaActorState, schemaId: string, version?: string): JsonValue | undefined {
  if (schemaId === state.schemaId) return undefined;
  return schemaError(
    version === undefined ? { schemaId: state.schemaId } : { schemaId: state.schemaId, version },
    "invalidRequest",
    "SCHEMA_ID_MISMATCH",
    `Schema actor '${state.schemaId}' cannot handle schemaId '${schemaId}'.`,
    { requestedSchemaId: schemaId },
  ) as unknown as JsonValue;
}
