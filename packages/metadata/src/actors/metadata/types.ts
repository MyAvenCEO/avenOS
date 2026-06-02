import type { JsonValue } from "typed-actors";
import type {
  ArtifactExistsCompleted,
} from "artifact-contracts";
import type {
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
} from "metadata-contracts";
import type { SchemaValidationCompleted } from "schema-contracts";
import type { ReplyAddress } from "shared";
import type { SchemaRef } from "schema/domain";

export const METADATA_INLINE_RESULT_MAX_BYTES = 2_048;
export const DEFAULT_METADATA_QUERY_LIMIT = 50;
export const MAX_METADATA_QUERY_LIMIT = 200;

export type MetadataErrorCategory =
  | "invalidRequest"
  | "schemaNotFound"
  | "schemaInvalid"
  | "artifactMissing"
  | "metadataInvalid"
  | "idempotencyConflict";

export type MetadataPendingAwaiting = "schemaValidation" | "artifactExists";

export interface PendingMetadataCreate {
  readonly requestId: string;
  readonly awaiting: MetadataPendingAwaiting;
  readonly subject: MetadataSubject;
  readonly schemaRef: SchemaRef;
  readonly value: JsonValue;
  readonly createdAt: string;
  readonly replyTo?: ReplyAddress;
  readonly previousRecordId?: string;
  readonly idempotencyKey?: string;
  readonly schemaHash?: string;
}

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
};