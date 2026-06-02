import { buildActorRuntime, defineActorShape, field, msg, op, type DerivedActorRuntime } from "typed-actors";
import type { RegisteredSchemaVersion } from "../../domain.ts";
import type { SchemaActorState, SchemaRegistryState } from "./types.ts";

const schemaDocumentDefault = {
  type: "object",
  required: ["invoiceNumber"],
  properties: { invoiceNumber: { type: "string" } },
} as const;

const schemaRefSchema = {
  type: "object",
  required: ["schemaId", "version"],
  additionalProperties: false,
  properties: {
    schemaId: { type: "string" },
    version: { type: "string" },
  },
} as const;

const replyAddressSchema = {
  type: "object",
  required: ["actorId", "actorKind"],
  additionalProperties: false,
  properties: {
    actorId: { type: "string" },
    actorKind: { type: "string" },
  },
} as const;

/**
 * Declarative schema subsystem descriptor slice.
 *
 * This shape currently covers the static registry/actor debug and operation metadata. The
 * schema actor still layers dynamic runtime defaults on top of these derived descriptors.
 */
export const schemaRegistryShape = defineActorShape({
  kind: "schemaRegistry",
  state: {
    schemaIds: field.ref<readonly string[]>({ default: [] }),
  },
  messages: {
    registerSchemaVersion: msg({
      schemaId: field.string({ default: "invoice" }),
      version: field.string({ default: "1.0.0" }),
      schema: field.schema({ type: "object" }, { default: schemaDocumentDefault }),
    }),
    resolveLatest: msg({
      schemaId: field.string({ default: "invoice" }),
    }),
    validateJson: msg({
      schemaId: field.string({ default: "invoice" }),
      version: field.string({ default: "1.0.0" }),
      value: field.schema({ type: "object" }, { default: { invoiceNumber: "INV-001" } }),
    }),
    validateJsonRequest: msg({
      requestId: field.string(),
      schemaRef: field.schema(schemaRefSchema),
      value: field.json(),
      replyTo: field.schema(replyAddressSchema, { optional: true }),
    }),
    getSchemaVersionRequest: msg({
      requestId: field.string(),
      schemaRef: field.schema(schemaRefSchema),
      replyTo: field.schema(replyAddressSchema, { optional: true }),
    }),
  },
  operations: {
    registerSchemaVersion: op({
      title: "Register schema version",
      description: "Register an immutable schema version for a schema family.",
      mutates: true,
    }),
    resolveLatest: op({
      title: "Resolve latest",
      description: "Resolve the latest registered version for a schema family.",
      mutates: true,
    }),
    validateJson: op({
      title: "Validate JSON",
      description: "Validate JSON against a pinned schema version.",
      mutates: true,
    }),
  },
  present(state) {
    return { title: "schemas", subtitle: `${state.schemaIds.length} families` };
  },
});

/** Declarative schema actor metadata baseline. */
export const schemaActorShape = defineActorShape({
  kind: "schema",
  state: {
    schemaId: field.string(),
    latestVersion: field.string({ optional: true }),
    versions: field.ref<Readonly<Record<string, RegisteredSchemaVersion>>>({ default: {} as Readonly<Record<string, RegisteredSchemaVersion>> }),
  },
  messages: schemaRegistryShape.messages,
  operations: schemaRegistryShape.operations,
  present(state) {
    return { title: state.schemaId, subtitle: state.latestVersion ?? "no versions" };
  },
});

/** Composed runtime for the schema registry actor. */
export const schemaRegistryRuntime = buildActorRuntime(schemaRegistryShape) as DerivedActorRuntime<
  typeof schemaRegistryShape.messages,
  SchemaRegistryState
>;

/** Composed runtime for the schema actor. */
export const schemaActorRuntime = buildActorRuntime(schemaActorShape) as DerivedActorRuntime<
  typeof schemaActorShape.messages,
  SchemaActorState
>;

/** Declarative input schema for schema-contract request messages shared by tree tooling. */
export const schemaRefRequestField = field.schema(schemaRefSchema);