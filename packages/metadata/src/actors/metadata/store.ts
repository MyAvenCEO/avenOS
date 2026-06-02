import type { JsonValue } from "typed-actors";
import type { AvenSqliteDatabase } from "typed-actors";
import type { MetadataQueryRecordsInput, MetadataSubject } from "metadata-contracts";
import { stableSchemaString, type SchemaRef } from "schema/domain";
import { cloneJsonValue } from "shared";

export interface MetadataRecord {
  readonly recordId: string;
  readonly schema: SchemaRef;
  readonly subject: MetadataSubject;
  readonly schemaHash: string;
  readonly value: JsonValue;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly previousRecordId?: string;
  readonly updatedAt?: string;
  readonly idempotencyKey?: string;
}

export interface MetadataQuery {
  readonly schemaId?: string;
  readonly version?: string | "latest";
  readonly subject: MetadataSubject | undefined;
  readonly limit: number;
  readonly cursor?: string;
  readonly filters?: ReadonlyArray<{
    readonly path: string;
    readonly op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "exists" | "contains";
    readonly value?: JsonValue;
  }>;
}

export interface MetadataQueryResult {
  readonly records: readonly MetadataRecord[];
  readonly nextCursor?: string;
}

export interface MetadataStore {
  put(record: MetadataRecord): Promise<MetadataRecord>;
  get(recordId: string): Promise<MetadataRecord | null>;
  query(query: MetadataQuery): Promise<MetadataQueryResult>;
  findByIdempotencyKey(input: { readonly subject: MetadataSubject; readonly schema: SchemaRef; readonly idempotencyKey: string }): Promise<MetadataRecord | undefined>;
}

function clone<T>(value: T): T {
  return cloneJsonValue(value);
}

export function metadataSubjectKey(subject: MetadataSubject): string {
  return stableSchemaString(subject as unknown as JsonValue);
}

function compareJson(left: JsonValue, right: JsonValue): number {
  if (left === right) return 0;
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "string" && typeof right === "string") return left.localeCompare(right);
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  return stableSchemaString(left).localeCompare(stableSchemaString(right));
}

function normalizePath(path: string): string {
  if (path === "$") {
    return "";
  }
  if (path.startsWith("$.")) {
    return path.slice(2);
  }
  if (path.startsWith("$")) {
    return path.slice(1);
  }
  return path;
}

type PathLookup = { readonly found: true; readonly value: JsonValue } | { readonly found: false };

function readPath(value: JsonValue, path: string): PathLookup {
  const normalized = normalizePath(path);
  if (normalized === "") {
    return { found: true, value };
  }
  const segments = normalized.split(".").filter(Boolean);
  let current: JsonValue | undefined = value;
  for (const segment of segments) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return { found: false };
    current = (current as Record<string, JsonValue>)[segment];
  }
  return current === undefined ? { found: false } : { found: true, value: current };
}

function matchesFilter(record: MetadataRecord, filter: NonNullable<MetadataQuery["filters"]>[number]): boolean {
  const actual = readPath(record.value, filter.path);
  switch (filter.op) {
    case "exists":
      return actual.found;
    case "eq":
      return actual.found && stableSchemaString(actual.value) === stableSchemaString(filter.value ?? null);
    case "neq":
      return !actual.found || stableSchemaString(actual.value) !== stableSchemaString(filter.value ?? null);
    case "gt":
      return actual.found && compareJson(actual.value, filter.value ?? null) > 0;
    case "gte":
      return actual.found && compareJson(actual.value, filter.value ?? null) >= 0;
    case "lt":
      return actual.found && compareJson(actual.value, filter.value ?? null) < 0;
    case "lte":
      return actual.found && compareJson(actual.value, filter.value ?? null) <= 0;
    case "contains":
      if (!actual.found) return false;
      if (typeof actual.value === "string" && typeof filter.value === "string") return actual.value.includes(filter.value);
      if (Array.isArray(actual.value)) return actual.value.some((entry) => stableSchemaString(entry) === stableSchemaString(filter.value ?? null));
      return false;
  }
}

function encodeCursor(record: MetadataRecord): string {
  return Buffer.from(JSON.stringify({ createdAt: record.createdAt, recordId: record.recordId }), "utf8").toString("base64");
}

function decodeCursor(cursor: string | undefined): { readonly createdAt: string; readonly recordId: string } | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64").toString("utf8")) as { createdAt?: string; recordId?: string };
    if (typeof parsed.createdAt !== "string" || typeof parsed.recordId !== "string") {
      throw new Error("Metadata query cursor is invalid.");
    }
    return { createdAt: parsed.createdAt, recordId: parsed.recordId };
  } catch {
    throw new Error("Metadata query cursor is invalid.");
  }
}

export class SqliteMetadataStore implements MetadataStore {
  constructor(private readonly db: AvenSqliteDatabase) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata_records (
        record_id          TEXT PRIMARY KEY,
        subject_type       TEXT NOT NULL,
        subject_key        TEXT NOT NULL,
        subject_json       TEXT NOT NULL,
        schema_id          TEXT NOT NULL,
        schema_version     TEXT NOT NULL,
        schema_ref_json    TEXT NOT NULL,
        schema_hash        TEXT NOT NULL,
        value_json         TEXT NOT NULL,
        idempotency_key    TEXT,
        previous_record_id TEXT,
        created_by         TEXT NOT NULL,
        created_at         TEXT NOT NULL,
        updated_at         TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_metadata_idempotency
      ON metadata_records (subject_key, schema_id, schema_version, idempotency_key)
      WHERE idempotency_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_metadata_subject
      ON metadata_records (subject_type, subject_key, created_at, record_id);
      CREATE INDEX IF NOT EXISTS idx_metadata_schema
      ON metadata_records (schema_id, schema_version, created_at, record_id);
    `);
  }

  async put(record: MetadataRecord): Promise<MetadataRecord> {
    this.db.prepare(`
      INSERT INTO metadata_records (
        record_id, subject_type, subject_key, subject_json, schema_id, schema_version,
        schema_ref_json, schema_hash, value_json, idempotency_key, previous_record_id,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.recordId,
      record.subject.type,
      metadataSubjectKey(record.subject),
      JSON.stringify(record.subject),
      record.schema.schemaId,
      record.schema.version,
      JSON.stringify(record.schema),
      record.schemaHash,
      JSON.stringify(record.value),
      record.idempotencyKey ?? null,
      record.previousRecordId ?? null,
      record.createdBy,
      record.createdAt,
      record.updatedAt ?? null,
    );
    return clone(record);
  }

  async get(recordId: string): Promise<MetadataRecord | null> {
    const row = this.db.prepare(`
      SELECT record_id, subject_json, schema_ref_json, schema_hash, value_json, created_by, created_at, previous_record_id, updated_at, idempotency_key
      FROM metadata_records WHERE record_id = ?
    `).get(recordId) as {
      record_id: string;
      subject_json: string;
      schema_ref_json: string;
      schema_hash: string;
      value_json: string;
      created_by: string;
      created_at: string;
      previous_record_id: string | null;
      updated_at: string | null;
      idempotency_key: string | null;
    } | undefined;
    if (!row) return null;
    return {
      recordId: row.record_id,
      subject: JSON.parse(row.subject_json) as MetadataSubject,
      schema: JSON.parse(row.schema_ref_json) as SchemaRef,
      schemaHash: row.schema_hash,
      value: JSON.parse(row.value_json) as JsonValue,
      createdBy: row.created_by,
      createdAt: row.created_at,
      ...(row.previous_record_id ? { previousRecordId: row.previous_record_id } : {}),
      ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
      ...(row.idempotency_key ? { idempotencyKey: row.idempotency_key } : {}),
    };
  }

  async query(query: MetadataQuery): Promise<MetadataQueryResult> {
    const rows = this.db.prepare(`
      SELECT record_id, subject_json, schema_ref_json, schema_hash, value_json, created_by, created_at, previous_record_id, updated_at, idempotency_key
      FROM metadata_records
      ORDER BY created_at, record_id
    `).all() as Array<{
      record_id: string;
      subject_json: string;
      schema_ref_json: string;
      schema_hash: string;
      value_json: string;
      created_by: string;
      created_at: string;
      previous_record_id: string | null;
      updated_at: string | null;
      idempotency_key: string | null;
    }>;
    let records = rows.map((row) => ({
        recordId: row.record_id,
        subject: JSON.parse(row.subject_json) as MetadataSubject,
        schema: JSON.parse(row.schema_ref_json) as SchemaRef,
        schemaHash: row.schema_hash,
        value: JSON.parse(row.value_json) as JsonValue,
        createdBy: row.created_by,
        createdAt: row.created_at,
        ...(row.previous_record_id ? { previousRecordId: row.previous_record_id } : {}),
        ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
        ...(row.idempotency_key ? { idempotencyKey: row.idempotency_key } : {}),
      } satisfies MetadataRecord));
    if (query.schemaId) records = records.filter((record) => record.schema.schemaId === query.schemaId);
    if (query.version === "latest") {
      throw new Error("metadata.queryRecords version 'latest' is not supported.");
    }
    if (query.version) records = records.filter((record) => record.schema.version === query.version);
    if (query.subject) records = records.filter((record) => stableSchemaString(record.subject) === stableSchemaString(query.subject));
    if (query.filters?.length) records = records.filter((record) => query.filters!.every((filter) => matchesFilter(record, filter)));

    records.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.recordId.localeCompare(right.recordId));

    const cursor = decodeCursor(query.cursor);
    const filteredByCursor = cursor
      ? records.filter((record) => record.createdAt > cursor.createdAt || (record.createdAt === cursor.createdAt && record.recordId > cursor.recordId))
      : records;
    const sliced = filteredByCursor.slice(0, query.limit);
    return {
      records: sliced.map((record) => clone(record)),
      ...(sliced.length === query.limit ? { nextCursor: encodeCursor(sliced[sliced.length - 1]!) } : {}),
    };
  }

  async findByIdempotencyKey(input: { readonly subject: MetadataSubject; readonly schema: SchemaRef; readonly idempotencyKey: string }): Promise<MetadataRecord | undefined> {
    const row = this.db.prepare(`
      SELECT record_id FROM metadata_records
      WHERE subject_key = ? AND schema_id = ? AND schema_version = ? AND idempotency_key = ?
      LIMIT 1
    `).get(
      metadataSubjectKey(input.subject),
      input.schema.schemaId,
      input.schema.version,
      input.idempotencyKey,
    ) as { record_id: string } | undefined;
    if (!row) return undefined;
    return (await this.get(row.record_id)) ?? undefined;
  }
}

export function normalizeMetadataQuery(input: MetadataQueryRecordsInput, defaults: { readonly defaultLimit: number; readonly maxLimit: number }): MetadataQuery {
  const requested = input.limit ?? defaults.defaultLimit;
  const limit = Math.max(1, Math.min(defaults.maxLimit, requested));
  return {
    schemaId: input.schemaId,
    version: input.version,
    subject: input.subject,
    limit,
    cursor: input.cursor,
    filters: input.filters,
  };
}
