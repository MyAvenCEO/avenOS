import {
  ActorId,
  openAvenSqliteDatabase,
  type AvenSqliteDatabase,
  type ActorContextWithRuntime,
  buildActorDefinition,
  type ActorContext,
  type ActorDefinitionMap,
  type JsonValue,
} from "typed-actors";
import type {
  ArtifactExistsCompleted,
  ArtifactExistsRequest,
} from "artifact-contracts";
import type {
  MetadataRecord,
  MetadataResult,
} from "metadata-contracts";
import type { SchemaValidationCompleted, ValidateJsonRequest } from "schema-contracts";
import type { DerivedDebugMessageDescriptor } from "typed-actors";
import type { DebugMessageDescriptor, AvenRegistry } from "../../runtime/src/spine.ts";
import { toReplyAddress } from "../../shared/src/index.ts";
import {
  SqliteMetadataStore,
  normalizeMetadataQuery,
  type MetadataStore,
} from "./actors/metadata/store.ts";
import { stableSchemaString } from "../../schema/src/domain.ts";
import {
  DEFAULT_METADATA_QUERY_LIMIT,
  MAX_METADATA_QUERY_LIMIT,
  type PendingMetadataCreate,
  type CreateMetadataRecordMessage,
  type GetMetadataRecordMessage,
  type ListMetadataBySchemaMessage,
  type ListMetadataBySubjectMessage,
  type MetadataQueryCompleted,
  type MetadataQueryResult,
  type MetadataQueryRecordsInput,
  type MetadataRecordCompleted,
  type MetadataRecordRef,
  type MetadataSubject,
  type QueryMetadataRecordsMessage,
} from "./actors/metadata/types.ts";
import {
  clone,
  createRecordId,
  fromStoredRecord,
  metadataError,
  subjectMatches,
  toNormalizedQueryRecord,
  toStoredRecord,
} from "./actors/metadata/support.ts";
import { metadataActorRuntime, metadataActorShape, type MetadataActorMessage, type MetadataActorState } from "./actors/metadata/shape.ts";

export const metadataDebugMessageDescriptors: readonly DebugMessageDescriptor[] = metadataActorRuntime.debugDescriptors.map((descriptor: DerivedDebugMessageDescriptor) => ({
  ...descriptor,
  id: descriptor.messageType,
  ...(descriptor.messageType === "getMetadataRecord"
    ? { description: "Load a metadata record by id." }
    : {}),
})) satisfies readonly DebugMessageDescriptor[];

export type {
  CreateMetadataRecordMessage,
  GetMetadataRecordMessage,
  ListMetadataBySchemaMessage,
  ListMetadataBySubjectMessage,
  MetadataQueryCompleted,
  MetadataQueryRecordsInput,
  MetadataQueryResult,
  MetadataRecord,
  MetadataRecordCompleted,
  MetadataRecordRef,
  MetadataResult,
  MetadataSubject,
  QueryMetadataRecordsMessage,
} from "./actors/metadata/types.ts";
export type { MetadataActorMessage, MetadataActorState } from "./actors/metadata/shape.ts";

export function buildMetadataSubsystemBundle(args: { readonly registry: AvenRegistry; readonly ActorKind: typeof import("../../runtime/src/spine.ts").ActorKind; readonly store?: MetadataStore; readonly sqliteDb?: AvenSqliteDatabase }) {
  return {
    definitions: buildMetadataSubsystemDefinitions(args),
    presentations: {},
  } as const;
}

export function buildMetadataSubsystemDefinitions(args: { readonly registry: AvenRegistry; readonly ActorKind: typeof import("../../runtime/src/spine.ts").ActorKind; readonly store?: MetadataStore; readonly sqliteDb?: AvenSqliteDatabase }) {
  const { registry, ActorKind } = args;
  const store = args.store ?? new SqliteMetadataStore(args.sqliteDb ?? openAvenSqliteDatabase("./aven-runtime.db"));

  type MetadataRuntimeContext = ActorContextWithRuntime<
    typeof registry,
    typeof ActorKind.Metadata,
    typeof metadataActorShape.messages,
    MetadataActorState
  >;

  const replyOrApplyRecordResult = (
    ctx: MetadataRuntimeContext,
    message: {
      readonly replyTo?: { readonly actorId: string; readonly actorKind: string };
      readonly requestId?: string;
    },
    result: MetadataResult,
  ) => {
    if (message.replyTo && message.requestId) {
      ctx.send(
        { id: ActorId.parse(message.replyTo.actorId), kind: message.replyTo.actorKind as never },
        { type: "metadataRecordCompleted", requestId: message.requestId, result } as never,
      );
      return;
    }
  };

  const replyOrApplyQueryResult = (
    ctx: MetadataRuntimeContext,
    message: {
      readonly replyTo?: { readonly actorId: string; readonly actorKind: string };
      readonly requestId?: string;
    },
    result: MetadataQueryResult,
  ) => {
    if (message.replyTo && message.requestId) {
      ctx.send(
        { id: ActorId.parse(message.replyTo.actorId), kind: message.replyTo.actorKind as never },
        { type: "metadataQueryCompleted", requestId: message.requestId, result } as never,
      );
      return;
    }
  };

  const finalizeCreatedRecord = async (
    ctx: MetadataRuntimeContext,
    requestId: string,
    pending: PendingMetadataCreate,
    record: MetadataRecord,
  ) => {
    await store.put(toStoredRecord(record));
    const storedRecord = clone(record);
    const nextPending = { ...ctx.state.pendingCreatesByRequestId };
    delete nextPending[requestId];
    ctx.setState({
      ...ctx.state,
      recordsById: { ...ctx.state.recordsById, [record.recordId]: storedRecord },
      pendingCreatesByRequestId: nextPending,
      idempotencyIndex: record.idempotencyKey ? { ...ctx.state.idempotencyIndex, [record.idempotencyKey]: record.recordId } : ctx.state.idempotencyIndex,
      nextRecordNumber: ctx.state.nextRecordNumber + 1,
    });
    if (pending.replyTo) {
      ctx.send(
        { id: ActorId.parse(pending.replyTo.actorId), kind: pending.replyTo.actorKind as never },
        { type: "metadataRecordCompleted", requestId, result: { type: "ok", record: clone(record) } } as never,
      );
    }
  };

  return {
    [ActorKind.Metadata]: buildActorDefinition<typeof registry, typeof ActorKind.Metadata, typeof metadataActorShape>(metadataActorShape, {
      kind: ActorKind.Metadata,
      receive: {
        async active(ctx: MetadataRuntimeContext, message: MetadataActorMessage) {
          if (message.type === "createMetadataRecord") {
            if (message.schemaRef.version === "latest") {
              const result = metadataError("invalidRequest", "schemaRef.version must not be 'latest'.");
              replyOrApplyRecordResult(ctx, message, result);
              return;
            }
            if (message.previousRecordId && !await store.get(message.previousRecordId)) {
              const result = metadataError("metadataInvalid", `previousRecordId '${message.previousRecordId}' was not found.`);
              replyOrApplyRecordResult(ctx, message, result);
              return;
            }
            if (message.previousRecordId) {
              const previous = await store.get(message.previousRecordId);
              if (previous && !subjectMatches(previous.subject, message.subject)) {
                const result = metadataError("metadataInvalid", "previousRecordId subject must match the new metadata subject.");
                replyOrApplyRecordResult(ctx, message, result);
                return;
              }
            }
            if (message.idempotencyKey) {
              const existing = await store.findByIdempotencyKey({
                subject: message.subject,
                schema: message.schemaRef,
                idempotencyKey: message.idempotencyKey,
              });
              if (existing) {
                if (
                    subjectMatches(existing.subject, message.subject)
                  && stableSchemaString(existing.schema as unknown as JsonValue) === stableSchemaString(message.schemaRef as unknown as JsonValue)
                  && stableSchemaString(existing.value) === stableSchemaString(message.value)
                ) {
                  const result: MetadataResult = { type: "ok", record: fromStoredRecord(existing) };
                  replyOrApplyRecordResult(ctx, message, result);
                } else {
                  const result = metadataError("idempotencyConflict", `idempotencyKey '${message.idempotencyKey}' is already used for a different payload.`);
                  replyOrApplyRecordResult(ctx, message, result);
                }
                return;
              }
            }
            const requestId = message.requestId ?? `meta-req~${Object.keys(ctx.state.pendingCreatesByRequestId).length + ctx.state.nextRecordNumber}`;
            const pending: PendingMetadataCreate = {
              requestId,
              awaiting: "schemaValidation",
              subject: clone(message.subject),
              schemaRef: clone(message.schemaRef),
              value: clone(message.value),
              createdAt: ctx.now.toISOString(),
              ...(message.replyTo === undefined ? {} : { replyTo: message.replyTo }),
              ...(message.previousRecordId === undefined ? {} : { previousRecordId: message.previousRecordId }),
              ...(message.idempotencyKey === undefined ? {} : { idempotencyKey: message.idempotencyKey }),
            };
            const request: ValidateJsonRequest = {
              type: "validateJsonRequest",
              requestId,
              schemaRef: clone(message.schemaRef),
              value: clone(message.value),
              replyTo: toReplyAddress(ctx.self.id, ActorKind.Metadata),
            };
            ctx.send({ id: ActorId.parse("/aven/system/schemas"), kind: ActorKind.SchemaRegistry }, request as never);
            ctx.setState({
              ...ctx.state,
              pendingCreatesByRequestId: { ...ctx.state.pendingCreatesByRequestId, [requestId]: pending },
            });
            return;
          }
          if (message.type === "schemaValidationCompleted") {
            const pending = ctx.state.pendingCreatesByRequestId[message.requestId];
            if (!pending) return;
            if (message.result.type === "error") {
              const nextPending = { ...ctx.state.pendingCreatesByRequestId };
              delete nextPending[message.requestId];
              const result = metadataError(message.result.error.category === "schemaNotFound" ? "schemaNotFound" : "schemaInvalid", message.result.error.message, clone((message.result.error.details ?? null) as JsonValue));
              ctx.setState({
                ...ctx.state,
                pendingCreatesByRequestId: nextPending,
              });
              if (pending.replyTo) {
                ctx.send({ id: ActorId.parse(pending.replyTo.actorId), kind: pending.replyTo.actorKind as never }, { type: "metadataRecordCompleted", requestId: message.requestId, result } as never);
              }
              return;
            }
            if (pending.subject.type !== "artifact") {
              const recordId = createRecordId({ ...pending, schemaHash: message.result.schemaHash }, ctx.state.nextRecordNumber);
              const record: MetadataRecord = {
                recordId,
                subject: clone(pending.subject),
                schemaRef: clone(pending.schemaRef),
                schemaHash: message.result.schemaHash,
                value: clone(pending.value),
                createdBy: ctx.self.id.toString(),
                createdAt: pending.createdAt,
                ...(pending.previousRecordId === undefined ? {} : { previousRecordId: pending.previousRecordId }),
                ...(pending.idempotencyKey === undefined ? {} : { idempotencyKey: pending.idempotencyKey }),
              };
              await finalizeCreatedRecord(ctx, message.requestId, pending, record);
              return;
            }
            const request: ArtifactExistsRequest = { type: "artifactExistsRequest", requestId: message.requestId, ref: clone(pending.subject.ref), replyTo: toReplyAddress(ctx.self.id, ActorKind.Metadata) };
            ctx.send({ id: ActorId.parse("/aven/system/artifacts"), kind: ActorKind.Artifacts }, request as never);
            ctx.setState({
              ...ctx.state,
              pendingCreatesByRequestId: {
                ...ctx.state.pendingCreatesByRequestId,
                [message.requestId]: { ...pending, awaiting: "artifactExists", schemaHash: message.result.schemaHash },
              },
            });
            return;
          }
          if (message.type === "artifactExistsCompleted") {
            const pending = ctx.state.pendingCreatesByRequestId[message.requestId];
            if (!pending) return;
            if (!message.exists) {
              const nextPending = { ...ctx.state.pendingCreatesByRequestId };
              delete nextPending[message.requestId];
              const result = metadataError("artifactMissing", `Artifact '${message.ref.artifactId}' was not found.`);
              ctx.setState({ ...ctx.state, pendingCreatesByRequestId: nextPending });
              if (pending.replyTo) {
                ctx.send({ id: ActorId.parse(pending.replyTo.actorId), kind: pending.replyTo.actorKind as never }, { type: "metadataRecordCompleted", requestId: message.requestId, result } as never);
              }
              return;
            }
            const recordId = createRecordId(pending, ctx.state.nextRecordNumber);
            const record: MetadataRecord = {
              recordId,
              subject: clone(pending.subject),
              schemaRef: clone(pending.schemaRef),
              schemaHash: pending.schemaHash ?? "",
              value: clone(pending.value),
              createdBy: ctx.self.id.toString(),
              createdAt: pending.createdAt,
              ...(pending.previousRecordId === undefined ? {} : { previousRecordId: pending.previousRecordId }),
              ...(pending.idempotencyKey === undefined ? {} : { idempotencyKey: pending.idempotencyKey }),
            };
            await finalizeCreatedRecord(ctx, message.requestId, pending, record);
            return;
          }
          if (message.type === "getMetadataRecord") {
            const record = await store.get(message.recordId);
            const result = (record ? { type: "ok", record: fromStoredRecord(record) } : metadataError("metadataInvalid", `Metadata record '${message.recordId}' was not found.`)) as MetadataResult;
            replyOrApplyRecordResult(ctx, message, result);
            return;
          }
          if (message.type === "queryMetadataRecords") {
            const query = normalizeMetadataQuery(message.query, { defaultLimit: DEFAULT_METADATA_QUERY_LIMIT, maxLimit: MAX_METADATA_QUERY_LIMIT });
            let result: MetadataQueryResult;
            try {
              const queried = await store.query(query);
              result = {
                type: "ok",
                records: queried.records.map((entry: Awaited<ReturnType<MetadataStore["query"]>>["records"][number]) => ({
                  recordId: entry.recordId,
                  schema: clone(entry.schema),
                  subject: clone(entry.subject),
                  value: clone(entry.value),
                  createdAt: entry.createdAt,
                  ...(entry.updatedAt === undefined ? {} : { updatedAt: entry.updatedAt }),
                })),
                ...(queried.nextCursor === undefined ? {} : { nextCursor: queried.nextCursor }),
              };
            } catch (error) {
              result = metadataError(
                "invalidRequest",
                error instanceof Error ? error.message : "Metadata query failed.",
              ) as MetadataQueryResult;
            }
            replyOrApplyQueryResult(ctx, message, result);
            return;
          }
          if (message.type === "listMetadataBySubject") {
            const query = normalizeMetadataQuery({ schemaId: undefined, version: undefined, subject: message.subject }, { defaultLimit: DEFAULT_METADATA_QUERY_LIMIT, maxLimit: MAX_METADATA_QUERY_LIMIT });
            const queried = await store.query(query);
            replyOrApplyQueryResult(ctx, message, { type: "ok", records: queried.records.map((record) => ({
              recordId: record.recordId,
              schema: clone(record.schema),
              subject: clone(record.subject),
              value: clone(record.value),
              createdAt: record.createdAt,
              ...(record.updatedAt === undefined ? {} : { updatedAt: record.updatedAt }),
            })), ...(queried.nextCursor ? { nextCursor: queried.nextCursor } : {}) });
            return;
          }
          if (message.type === "listMetadataBySchema") {
            if (message.schemaRef.version === "latest") {
              replyOrApplyQueryResult(ctx, message, metadataError("invalidRequest", "schemaRef.version must not be 'latest'.") as MetadataQueryResult);
              return;
            }
            const queried = await store.query(normalizeMetadataQuery({ schemaId: message.schemaRef.schemaId, version: message.schemaRef.version, subject: undefined }, { defaultLimit: DEFAULT_METADATA_QUERY_LIMIT, maxLimit: MAX_METADATA_QUERY_LIMIT }));
            replyOrApplyQueryResult(ctx, message, { type: "ok", records: queried.records.map((record) => ({
              recordId: record.recordId,
              schema: clone(record.schema),
              subject: clone(record.subject),
              value: clone(record.value),
              createdAt: record.createdAt,
              ...(record.updatedAt === undefined ? {} : { updatedAt: record.updatedAt }),
            })), ...(queried.nextCursor ? { nextCursor: queried.nextCursor } : {}) });
            return;
          }
          return;
        },
      },
    }),
  } satisfies Pick<ActorDefinitionMap<typeof registry>, typeof ActorKind.Metadata>;
}

