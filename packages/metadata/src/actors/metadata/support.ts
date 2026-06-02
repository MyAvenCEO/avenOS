import { createHash } from "node:crypto";
import type { JsonValue } from "typed-actors";
import type { PendingAsyncResult as SharedPendingAsyncResult } from "../../../../actor-contracts/src/index.ts";
import { cloneJsonValue, toInlineJsonPreview } from "shared";
import { stableSchemaString, type SchemaRef } from "schema/domain";
import type {
  MetadataErrorCategory,
  MetadataPendingAwaiting,
  MetadataRecord,
  MetadataResult,
  MetadataSubject,
  PendingMetadataCreate,
} from "./types.ts";
import type { MetadataRecord as StoredMetadataRecord } from "./store.ts";
import { METADATA_INLINE_RESULT_MAX_BYTES } from "./types.ts";

export function clone<T>(value: T): T {
  return cloneJsonValue(value);
}

export function metadataError(category: MetadataErrorCategory, message: string, details?: JsonValue): MetadataResult {
  return { type: "error", error: { category, message, ...(details === undefined ? {} : { details }) } };
}

export function inlineResult(value: JsonValue): JsonValue {
  return toInlineJsonPreview(value, { maxBytes: METADATA_INLINE_RESULT_MAX_BYTES });
}

export function pendingAsyncResult(requestId: string, awaiting: MetadataPendingAwaiting): SharedPendingAsyncResult<MetadataPendingAwaiting> {
  return {
    type: "pending",
    requestId,
    awaiting,
  };
}

export function subjectKey(subject: MetadataSubject): string {
  return stableSchemaString(subject as unknown as JsonValue);
}

export function subjectMatches(left: MetadataSubject, right: MetadataSubject): boolean {
  return subjectKey(left) === subjectKey(right);
}

export function createRecordId(pending: PendingMetadataCreate, nextRecordNumber: number): string {
  return `rec~${createHash("sha256").update(`${subjectKey(pending.subject)}:${pending.createdAt}:${nextRecordNumber}:${pending.schemaHash ?? ""}`).digest("hex").slice(0, 16)}`;
}

export function toStoredRecord(record: MetadataRecord): StoredMetadataRecord {
  return {
    recordId: record.recordId,
    schema: clone(record.schemaRef),
    subject: clone(record.subject),
    schemaHash: record.schemaHash,
    value: clone(record.value),
    createdBy: record.createdBy,
    createdAt: record.createdAt,
    ...(record.previousRecordId === undefined ? {} : { previousRecordId: record.previousRecordId }),
    ...(record.updatedAt === undefined ? {} : { updatedAt: record.updatedAt }),
    ...(record.idempotencyKey === undefined ? {} : { idempotencyKey: record.idempotencyKey }),
  };
}

export function fromStoredRecord(entry: StoredMetadataRecord): MetadataRecord {
  return {
    recordId: entry.recordId,
    subject: clone(entry.subject),
    schemaRef: clone(entry.schema),
    schemaHash: entry.schemaHash,
    value: clone(entry.value),
    createdBy: entry.createdBy,
    createdAt: entry.createdAt,
    ...(entry.previousRecordId === undefined ? {} : { previousRecordId: entry.previousRecordId }),
    ...(entry.updatedAt === undefined ? {} : { updatedAt: entry.updatedAt }),
    ...(entry.idempotencyKey === undefined ? {} : { idempotencyKey: entry.idempotencyKey }),
  };
}

export function recordSummary(record: MetadataRecord): JsonValue {
  return {
    recordId: record.recordId,
    subject: clone(record.subject as unknown as JsonValue),
    schemaRef: clone(record.schemaRef as unknown as JsonValue),
    schemaHash: record.schemaHash,
    createdBy: record.createdBy,
    createdAt: record.createdAt,
    ...(record.updatedAt === undefined ? {} : { updatedAt: record.updatedAt }),
  } as JsonValue;
}

export function toNormalizedQueryRecord(record: MetadataRecord): { readonly recordId: string; readonly schema: SchemaRef; readonly subject: MetadataSubject; readonly value: JsonValue; readonly createdAt: string; readonly updatedAt?: string } {
  return {
    recordId: record.recordId,
    schema: clone(record.schemaRef),
    subject: clone(record.subject),
    value: clone(record.value),
    createdAt: record.createdAt,
    ...(record.updatedAt === undefined ? {} : { updatedAt: record.updatedAt }),
  };
}
