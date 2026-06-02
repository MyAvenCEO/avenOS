import type { JsonValue } from "typed-actors";
import type {
  GetSchemaVersionRequest,
  SchemaValidationCompleted,
  SchemaVersionCompleted,
  ValidateJsonRequest,
} from "schema-contracts";
import type { RegisteredSchemaVersion } from "../../domain.ts";

export type RegisterSchemaVersionMessage = {
  readonly type: "registerSchemaVersion";
  readonly schemaId: string;
  readonly version: string;
  readonly schema: JsonValue;
};

export type ResolveLatestMessage = {
  readonly type: "resolveLatest";
  readonly schemaId: string;
};

export type ValidateJsonMessage = {
  readonly type: "validateJson";
  readonly schemaId: string;
  readonly version: string;
  readonly value: JsonValue;
};

export type SchemaRegistryMessage =
  | RegisterSchemaVersionMessage
  | ResolveLatestMessage
  | ValidateJsonMessage
  | ValidateJsonRequest
  | GetSchemaVersionRequest;

export type SchemaMessage =
  | RegisterSchemaVersionMessage
  | ResolveLatestMessage
  | ValidateJsonMessage
  | ValidateJsonRequest
  | GetSchemaVersionRequest;

export type SchemaRegistryState = {
  readonly schemaIds: readonly string[];
};

export interface SchemaActorState {
  readonly schemaId: string;
  readonly latestVersion?: string;
  readonly versions: Readonly<Record<string, RegisteredSchemaVersion>>;
}

export type {
  GetSchemaVersionRequest,
  SchemaValidationCompleted,
  SchemaVersionCompleted,
  ValidateJsonRequest,
} from "schema-contracts";
