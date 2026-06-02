import {
  buildActorDefinition,
  type ActorDefinitionMap,
  type JsonValue,
} from "typed-actors";
import type { DebugMessageDescriptor } from "../../runtime/src/spine.ts";
import { createSchemaValidationService } from "./actors/schema/validation-service.ts";
import { schemaError } from "./domain.ts";
import {
  cloneJsonValue,
  rejectSchemaIdMismatch,
  registerVersion,
  resolveLatest,
  sendSchemaValidationCompleted,
  sendSchemaVersionCompleted,
  validatePinned,
} from "./actors/registry/support.ts";
import { schemaActorRuntime, schemaActorShape, schemaRegistryRuntime, schemaRegistryShape } from "./actors/registry/shape.ts";
import {
  type GetSchemaVersionRequest,
  type RegisterSchemaVersionMessage,
  type ResolveLatestMessage,
  type SchemaActorState,
  type SchemaMessage,
  type SchemaRegistryMessage,
  type SchemaRegistryState,
  type SchemaValidationCompleted,
  type SchemaVersionCompleted,
  type ValidateJsonMessage,
  type ValidateJsonRequest,
} from "./actors/registry/types.ts";

export type {
  GetSchemaVersionRequest,
  RegisterSchemaVersionMessage,
  ResolveLatestMessage,
  SchemaActorState,
  SchemaMessage,
  SchemaRegistryMessage,
  SchemaRegistryState,
  SchemaValidationCompleted,
  SchemaVersionCompleted,
  ValidateJsonMessage,
  ValidateJsonRequest,
} from "./actors/registry/types.ts";

export const schemaDebugMessageDescriptors: readonly DebugMessageDescriptor[] = schemaRegistryRuntime.debugDescriptors;
export const schemaActorDebugMessageDescriptors: readonly DebugMessageDescriptor[] = schemaActorRuntime.debugDescriptors;

const debugMessageValidationService = createSchemaValidationService();

export function validateDebugMessage(descriptor: DebugMessageDescriptor, message: unknown): string[] {
  return [...debugMessageValidationService.validateAdhocValue(descriptor.schema, message)];
}

export function getSchemaRegistryActorId() {
  return "/aven/system/schemas";
}

export function buildSchemaSubsystemBundle(args: {
  readonly registry: import("../../runtime/src/spine.ts").AvenRegistry;
  readonly ActorKind: typeof import("../../runtime/src/spine.ts").ActorKind;
}) {
  return {
    definitions: buildSchemaSubsystemDefinitions(args),
    presentations: {},
  } as const;
}

export function buildSchemaSubsystemDefinitions(args: {
  readonly registry: import("../../runtime/src/spine.ts").AvenRegistry;
  readonly ActorKind: typeof import("../../runtime/src/spine.ts").ActorKind;
}) {
  const { registry, ActorKind } = args;
  const service = createSchemaValidationService();

  return {
    [ActorKind.SchemaRegistry]: buildActorDefinition<typeof registry, typeof ActorKind.SchemaRegistry, typeof schemaRegistryShape>(schemaRegistryShape, {
      kind: ActorKind.SchemaRegistry,
      receive: {
        active(ctx, rawMessage) {
          const state = ctx.state as SchemaRegistryState;
          const message = rawMessage as SchemaRegistryMessage;
          if (message.type === "registerSchemaVersion") {
            const childId = ctx.self.id.child(message.schemaId);
            if (!state.schemaIds.includes(message.schemaId)) {
              ctx.spawn(ActorKind.Schema, { id: childId, init: { schemaId: message.schemaId } });
              ctx.setState(cloneJsonValue({ ...state, schemaIds: [...state.schemaIds, message.schemaId].sort() }));
            }
            ctx.send({ id: childId, kind: ActorKind.Schema }, message);
            return;
          }
          if (message.type === "validateJsonRequest") {
            if (!state.schemaIds.includes(message.schemaRef.schemaId)) {
              sendSchemaValidationCompleted(
                ctx,
                message.requestId,
                message.replyTo,
                schemaError(
                  { schemaId: message.schemaRef.schemaId, version: message.schemaRef.version },
                  "schemaNotFound",
                  "SCHEMA_FAMILY_NOT_FOUND",
                  `Schema family '${message.schemaRef.schemaId}' was not found.`,
                ),
              );
              return;
            }
            ctx.send({ id: ctx.self.id.child(message.schemaRef.schemaId), kind: ActorKind.Schema }, message);
            return;
          }
          if (message.type === "getSchemaVersionRequest") {
            if (!state.schemaIds.includes(message.schemaRef.schemaId)) {
              sendSchemaVersionCompleted(
                ctx,
                message.requestId,
                message.replyTo,
                schemaError(
                  { schemaId: message.schemaRef.schemaId, version: message.schemaRef.version },
                  "schemaNotFound",
                  "SCHEMA_FAMILY_NOT_FOUND",
                  `Schema family '${message.schemaRef.schemaId}' was not found.`,
                ) as Extract<import("./domain.ts").SchemaValidationResult, { readonly type: "error" }>,
              );
              return;
            }
            ctx.send({ id: ctx.self.id.child(message.schemaRef.schemaId), kind: ActorKind.Schema }, message);
            return;
          }
          if (!state.schemaIds.includes(message.schemaId)) {
            return;
          }
          ctx.send({ id: ctx.self.id.child(message.schemaId), kind: ActorKind.Schema }, message);
        },
      },
    }),
    [ActorKind.Schema]: buildActorDefinition<typeof registry, typeof ActorKind.Schema, typeof schemaActorShape>(schemaActorShape, {
      kind: ActorKind.Schema,
      receive: {
        active(ctx, rawMessage) {
          const state = ctx.state as SchemaActorState;
          const message = rawMessage as SchemaMessage;
          if (message.type === "registerSchemaVersion") {
            ctx.setState(cloneJsonValue(registerVersion(state, service, ctx.now, message)));
            return;
          }
          if (message.type === "validateJsonRequest") {
            if (message.schemaRef.schemaId !== state.schemaId) {
              sendSchemaValidationCompleted(
                ctx,
                message.requestId,
                message.replyTo,
                schemaError(
                  { schemaId: state.schemaId, version: message.schemaRef.version },
                  "invalidRequest",
                  "SCHEMA_ID_MISMATCH",
                  `Schema actor '${state.schemaId}' cannot handle schemaId '${message.schemaRef.schemaId}'.`,
                  { requestedSchemaId: message.schemaRef.schemaId },
                ),
              );
              return;
            }
            sendSchemaValidationCompleted(
              ctx,
              message.requestId,
              message.replyTo,
              validatePinned(state, service, message.schemaRef.version, message.value as JsonValue),
            );
            return;
          }
          if (message.type === "getSchemaVersionRequest") {
            if (message.schemaRef.schemaId !== state.schemaId) {
              sendSchemaVersionCompleted(
                ctx,
                message.requestId,
                message.replyTo,
                schemaError(
                  { schemaId: state.schemaId, version: message.schemaRef.version },
                  "invalidRequest",
                  "SCHEMA_ID_MISMATCH",
                  `Schema actor '${state.schemaId}' cannot handle schemaId '${message.schemaRef.schemaId}'.`,
                  { requestedSchemaId: message.schemaRef.schemaId },
                ) as Extract<import("./domain.ts").SchemaValidationResult, { readonly type: "error" }>,
              );
              return;
            }
            if (message.schemaRef.version === "latest") {
              sendSchemaVersionCompleted(
                ctx,
                message.requestId,
                message.replyTo,
                schemaError(
                  { schemaId: state.schemaId, version: message.schemaRef.version },
                  "invalidRequest",
                  "SCHEMA_VERSION_LATEST_UNSUPPORTED",
                  "Schema version 'latest' is not supported for schema.get.",
                ) as Extract<import("./domain.ts").SchemaValidationResult, { readonly type: "error" }>,
              );
              return;
            }
            const versionRecord = state.versions[message.schemaRef.version];
            if (!versionRecord) {
              sendSchemaVersionCompleted(
                ctx,
                message.requestId,
                message.replyTo,
                schemaError(
                  { schemaId: state.schemaId, version: message.schemaRef.version },
                  "schemaNotFound",
                  "SCHEMA_VERSION_NOT_FOUND",
                  `Schema '${state.schemaId}@${message.schemaRef.version}' was not found.`,
                ) as Extract<import("./domain.ts").SchemaValidationResult, { readonly type: "error" }>,
              );
              return;
            }
            sendSchemaVersionCompleted(ctx, message.requestId, message.replyTo, {
              type: "ok",
              schemaRef: versionRecord.schemaRef,
              schemaHash: versionRecord.schemaHash,
              schema: cloneJsonValue(versionRecord.schema as JsonValue),
            });
            return;
          }
          if (message.type === "resolveLatest") {
            if (rejectSchemaIdMismatch(state, message.schemaId)) {
              return;
            }
            return;
          }
          if (rejectSchemaIdMismatch(state, message.schemaId, message.version)) {
            return;
          }
        },
      },
    }),
  } satisfies Pick<ActorDefinitionMap<typeof registry>, typeof ActorKind.SchemaRegistry | typeof ActorKind.Schema>;
}
