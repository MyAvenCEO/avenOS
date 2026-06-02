import { buildActorRuntime, defineActorShape, field, msg, op, type DerivedActorRuntime, type InferMessages, type InferState, type JsonValue } from "typed-actors";
import type { MetadataRecord } from "metadata-contracts";
import type { SchemaValidationCompleted } from "schema-contracts";
import type { PendingMetadataCreate } from "./types.ts";

const metadataSubjectSchema = {
  oneOf: [
    {
      type: "object",
      required: ["type", "ref"],
      additionalProperties: false,
      properties: {
        type: { const: "artifact" },
        ref: {
          type: "object",
          required: ["artifactId", "blob"],
          additionalProperties: false,
          properties: {
            artifactId: { type: "string" },
            blob: {
              type: "object",
              required: ["algorithm", "hash", "sizeBytes"],
              additionalProperties: false,
              properties: {
                algorithm: { const: "sha256" },
                hash: { type: "string" },
                sizeBytes: { type: "integer", minimum: 0 },
              },
            },
          },
        },
      },
    },
    {
      type: "object",
      required: ["type", "ref"],
      additionalProperties: false,
      properties: {
        type: { const: "intent" }, intentId: { type: "string" } } },
    { type: "object", required: ["type", "toolRunId"], additionalProperties: false, properties: { type: { const: "toolRun" }, toolRunId: { type: "string" } } },
    { type: "object", required: ["type", "requestId"], additionalProperties: false, properties: { type: { const: "llmRequest" }, requestId: { type: "string" } } },
  ],
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

const metadataQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    schemaId: { type: "string" },
    version: { type: "string" },
    subject: metadataSubjectSchema,
    limit: { type: "integer", minimum: 1, maximum: 200 },
    cursor: { type: "string" },
    filters: {
      type: "array",
      items: {
        type: "object",
        required: ["path", "op"],
        additionalProperties: false,
        properties: {
          path: { type: "string" },
          op: { enum: ["eq", "neq", "gt", "gte", "lt", "lte", "exists", "contains"] },
          value: {},
        },
      },
    },
  },
  default: { schemaId: "invoice", version: "1.1.0", limit: 50 },
} as const;

/**
 * First declarative metadata actor slice.
 *
 * For now this shape is used to derive tree/debug operation metadata from a single source of
 * truth. Runtime receive/init/state derivation will follow in later phases.
 */
export const metadataActorShape = defineActorShape({
  kind: "metadata",
  state: {
    recordsById: field.ref<Readonly<Record<string, MetadataRecord>>>({ default: {} as Readonly<Record<string, MetadataRecord>> }),
    pendingCreatesByRequestId: field.ref<Readonly<Record<string, PendingMetadataCreate>>>({ default: {} as Readonly<Record<string, PendingMetadataCreate>> }),
    idempotencyIndex: field.ref<Readonly<Record<string, string>>>({ default: {} as Readonly<Record<string, string>> }),
    nextRecordNumber: field.integer({ default: 1 }),
  },
  messages: {
    createMetadataRecord: msg({
      requestId: field.string({ optional: true }),
      replyTo: field.json({ optional: true }),
      subject: field.schema(metadataSubjectSchema),
      schemaRef: field.schema(schemaRefSchema),
      value: field.json(),
      idempotencyKey: field.string({ optional: true }),
      previousRecordId: field.string({ optional: true }),
    }),
    getMetadataRecord: msg({
      requestId: field.string({ optional: true }),
      replyTo: field.json({ optional: true }),
      recordId: field.string({ default: "rec~..." }),
    }),
    listMetadataBySchema: msg({
      requestId: field.string({ optional: true }),
      replyTo: field.json({ optional: true }),
      schemaRef: field.schema(schemaRefSchema, { default: { schemaId: "invoice", version: "1.0.0" } }),
    }),
    listMetadataBySubject: msg({
      requestId: field.string({ optional: true }),
      replyTo: field.json({ optional: true }),
      subject: field.schema(metadataSubjectSchema),
    }),
    queryMetadataRecords: msg({
      requestId: field.string({ optional: true }),
      replyTo: field.json({ optional: true }),
      query: field.schema(metadataQuerySchema),
    }),
    schemaValidationCompleted: msg({
      requestId: field.string(),
      result: field.ref<SchemaValidationCompleted["result"]>(),
    }),
    artifactExistsCompleted: msg({
      requestId: field.string(),
      ref: field.schema({
        type: "object",
        required: ["artifactId", "blob"],
        additionalProperties: false,
        properties: {
          artifactId: { type: "string" },
          blob: {
            type: "object",
            required: ["algorithm", "hash", "sizeBytes"],
            additionalProperties: false,
            properties: {
              algorithm: { const: "sha256" },
              hash: { type: "string" },
              sizeBytes: { type: "integer", minimum: 0 },
            },
          },
        },
      }),
      exists: field.boolean(),
    }),
  },
  operations: {
    getMetadataRecord: op({
      title: "Get metadata record",
      description: "Load the immutable metadata record at this path.",
      input: {
        recordId: field.string({ default: "rec~..." }),
      },
    }),
    createMetadataRecord: op({
      title: "Create metadata record",
      description: "Create validated immutable metadata.",
      mutates: true,
      input: {
        subject: field.schema(metadataSubjectSchema),
        schemaRef: field.schema(schemaRefSchema, { default: { schemaId: "invoice", version: "1.0.0" } }),
        value: field.json({ default: { invoiceNumber: "INV-001" } }),
        idempotencyKey: field.string({ optional: true, default: "example-invoice-metadata-001" }),
        previousRecordId: field.string({ optional: true }),
      },
    }),
    listMetadataBySchema: op({
      title: "List metadata by schema",
      description: "List records by exact schema version.",
      input: {
        schemaRef: field.schema(schemaRefSchema, { default: { schemaId: "invoice", version: "1.0.0" } }),
      },
    }),
    queryMetadataRecords: op({
      title: "Query metadata records",
      description: "Query bounded metadata records with optional filters.",
      input: {
        schemaId: field.string({ optional: true, default: "invoice" }),
        version: field.string({ optional: true, default: "1.1.0" }),
        subject: field.schema(metadataSubjectSchema, { optional: true }),
        limit: field.integer({ optional: true, default: 50 }),
        cursor: field.string({ optional: true }),
        filters: field.schema({
          type: "array",
          items: {
            type: "object",
            required: ["path", "op"],
            additionalProperties: false,
            properties: {
              path: { type: "string" },
              op: { enum: ["eq", "neq", "gt", "gte", "lt", "lte", "exists", "contains"] },
              value: {},
            },
          },
        }, { optional: true }),
      },
    }),
  },
  present(state) {
    return { title: "metadata", subtitle: `${Object.keys(state.recordsById).length} records` };
  },
});

export type MetadataActorState = InferState<typeof metadataActorShape>;

export type MetadataActorMessage = InferMessages<typeof metadataActorShape.messages>;

/**
 * Composed metadata runtime derived from the declarative metadata shape.
 *
 * This is the first subsystem proof of `buildActorRuntime(...)`: metadata now consumes a
 * single derived runtime surface instead of wiring message guards, state helpers, and
 * operation/debug artifacts independently.
 */
export const metadataActorRuntime = buildActorRuntime(metadataActorShape) as DerivedActorRuntime<
  typeof metadataActorShape.messages,
  MetadataActorState
> & {
  readonly isMessage: (value: unknown) => value is MetadataActorMessage;
};