import { createHash, randomUUID } from "node:crypto";
import { extname } from "node:path";
import { TextDecoder, TextEncoder } from "node:util";
import { ActorId, openAvenSqliteDatabase, type AvenSqliteDatabase, type JsonObject, type JsonValue } from "typed-actors";
import type {
  ArtifactDescriptor,
  ArtifactRef,
  ArtifactSource,
  ArtifactReadBytesCompleted,
  ArtifactReadBytesError,
  ArtifactReadBytesOk,
  BlobDescriptor,
  BlobRef,
} from "artifact-contracts";
import type { ArtifactActorState } from "./actors/artifact/types.ts";
import { cloneJsonValue, deadlineAfter, isExpired, toInlineJsonPreview, type ReplyAddress } from "shared";
import { isJsonObject as sharedIsJsonObject } from "shared";

export const textEncoder = new TextEncoder();
export const textDecoder = new TextDecoder();
const fatalUtf8TextDecoder = new TextDecoder("utf-8", { fatal: true });
export const DEFAULT_PREVIEW_MAX_CHARS = 4096;
export const MAX_ARTIFACT_READ_BYTES = 64 * 1024;
export const MAX_JSON_ARTIFACT_BYTES = 4 * 1024 * 1024;
export const ARTIFACT_PENDING_TTL_MS = 60_000;
export const ARTIFACT_INLINE_RESULT_MAX_BYTES = 2_048;

export type ArtifactErrorCategory =
  | "artifactMissing"
  | "invalidRequest"
  | "rangeOutOfBounds"
  | "readTooLarge"
  | "storageInconsistent"
  | "unsupportedMime"
  | "outputInvalid";

export type ArtifactErrorResult = JsonValue & ArtifactReadBytesError;

export interface ArtifactWrite {
  readonly bytes: Uint8Array;
  readonly declaredMimeType?: string;
  readonly filename?: string;
  readonly source?: ArtifactSource;
  readonly metadata?: JsonObject;
  readonly createdAt?: string;
}

export interface ArtifactStorage {
  putArtifact(input: ArtifactWrite): Promise<ArtifactDescriptor>;
  getArtifact(ref: ArtifactRef): Promise<ArtifactDescriptor | undefined>;
  getBlobDescriptor(ref: BlobRef): Promise<BlobDescriptor | undefined>;
  blobExists(ref: BlobRef): Promise<boolean>;
  readBlob(ref: BlobRef): Promise<Uint8Array>;
  readBlobRange(ref: BlobRef, offset: number, length: number): Promise<Uint8Array>;
}

export class SqliteArtifactStorage implements ArtifactStorage {
  private readonly db: AvenSqliteDatabase;

  constructor(pathOrDb: string | AvenSqliteDatabase) {
    this.db = typeof pathOrDb === "string"
      ? openAvenSqliteDatabase(pathOrDb)
      : pathOrDb;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS artifact_blobs (
        algorithm           TEXT    NOT NULL CHECK (algorithm = 'sha256'),
        hash                TEXT    NOT NULL,
        size_bytes          INTEGER NOT NULL CHECK (size_bytes >= 0),
        bytes               BLOB    NOT NULL,
        detected_mime_type  TEXT,
        effective_mime_type TEXT    NOT NULL,
        created_at          TEXT    NOT NULL,
        PRIMARY KEY (algorithm, hash, size_bytes),
        CHECK (length(bytes) = size_bytes)
      );
      CREATE INDEX IF NOT EXISTS idx_artifact_blobs_ref ON artifact_blobs (algorithm, hash, size_bytes);
      CREATE TABLE IF NOT EXISTS artifacts (
        artifact_id         TEXT    PRIMARY KEY,
        algorithm           TEXT    NOT NULL,
        hash                TEXT    NOT NULL,
        size_bytes          INTEGER NOT NULL,
        declared_mime_type  TEXT,
        filename            TEXT,
        source_kind         TEXT,
        source_uri          TEXT,
        metadata_json       TEXT,
        created_at          TEXT    NOT NULL,
        FOREIGN KEY (algorithm, hash, size_bytes) REFERENCES artifact_blobs (algorithm, hash, size_bytes)
      );
      CREATE INDEX IF NOT EXISTS idx_artifacts_blob ON artifacts (algorithm, hash, size_bytes);
      CREATE INDEX IF NOT EXISTS idx_artifacts_created_at ON artifacts (created_at);
    `);
  }

  async putArtifact(input: ArtifactWrite): Promise<ArtifactDescriptor> {
    const bytes = new Uint8Array(input.bytes);
    const blob = createBlobRef(bytes);
    const createdAt = input.createdAt ?? new Date().toISOString();
    const mime = resolveMimeType(bytes, input.declaredMimeType, input.filename);
    const existingBlob = this.db.prepare(`
      SELECT algorithm, hash, size_bytes, detected_mime_type, effective_mime_type, created_at
      FROM artifact_blobs
      WHERE algorithm = ? AND hash = ? AND size_bytes = ?
    `).get(blob.algorithm, blob.hash, blob.sizeBytes) as {
      algorithm: string;
      hash: string;
      size_bytes: number;
      detected_mime_type: string | null;
      effective_mime_type: string;
      created_at: string;
    } | undefined;
    if (!existingBlob) {
      this.db.prepare(`
        INSERT INTO artifact_blobs (algorithm, hash, size_bytes, bytes, detected_mime_type, effective_mime_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        blob.algorithm,
        blob.hash,
        blob.sizeBytes,
        Buffer.from(bytes),
        mime.detectedMimeType ?? null,
        mime.effectiveMimeType,
        createdAt,
      );
    }
    const artifactId = randomUUID();
    this.db.prepare(`
      INSERT INTO artifacts (artifact_id, algorithm, hash, size_bytes, declared_mime_type, filename, source_kind, source_uri, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      artifactId,
      blob.algorithm,
      blob.hash,
      blob.sizeBytes,
      input.declaredMimeType ?? null,
      input.filename ?? null,
      input.source?.kind ?? null,
      input.source?.uri ?? null,
      input.metadata ? stableJsonStringify(input.metadata) : null,
      createdAt,
    );
    const blobDescriptor = await this.getBlobDescriptor(blob);
    return {
      artifactId,
      blob,
      declaredMimeType: input.declaredMimeType,
      detectedMimeType: blobDescriptor?.detectedMimeType,
      effectiveMimeType: blobDescriptor?.effectiveMimeType ?? mime.effectiveMimeType,
      filename: input.filename,
      source: input.source,
      createdAt,
    };
  }

  async getArtifact(ref: ArtifactRef): Promise<ArtifactDescriptor | undefined> {
    const row = this.db.prepare(`
      SELECT a.artifact_id, a.algorithm, a.hash, a.size_bytes, a.declared_mime_type, a.filename, a.source_kind, a.source_uri, a.created_at,
             b.detected_mime_type, b.effective_mime_type
      FROM artifacts a
      JOIN artifact_blobs b ON b.algorithm = a.algorithm AND b.hash = a.hash AND b.size_bytes = a.size_bytes
      WHERE a.artifact_id = ?
    `).get(ref.artifactId) as {
      artifact_id: string;
      algorithm: "sha256";
      hash: string;
      size_bytes: number;
      declared_mime_type: string | null;
      filename: string | null;
      source_kind: ArtifactSource["kind"] | null;
      source_uri: string | null;
      created_at: string;
      detected_mime_type: string | null;
      effective_mime_type: string;
    } | undefined;
    if (!row) return undefined;
    const blob: BlobRef = { algorithm: row.algorithm, hash: row.hash, sizeBytes: row.size_bytes };
    if (!matchesBlobRef(blob, ref.blob)) return undefined;
    return {
      artifactId: row.artifact_id,
      blob,
      declaredMimeType: row.declared_mime_type ?? undefined,
      detectedMimeType: row.detected_mime_type ?? undefined,
      effectiveMimeType: row.effective_mime_type,
      filename: row.filename ?? undefined,
      source: row.source_kind ? { kind: row.source_kind, ...(row.source_uri ? { uri: row.source_uri } : {}) } : undefined,
      createdAt: row.created_at,
    };
  }

  async getBlobDescriptor(ref: BlobRef): Promise<BlobDescriptor | undefined> {
    const row = this.db.prepare(`
      SELECT algorithm, hash, size_bytes, detected_mime_type, effective_mime_type, created_at
      FROM artifact_blobs
      WHERE algorithm = ? AND hash = ? AND size_bytes = ?
    `).get(ref.algorithm, ref.hash, ref.sizeBytes) as {
      algorithm: "sha256";
      hash: string;
      size_bytes: number;
      detected_mime_type: string | null;
      effective_mime_type: string;
      created_at: string;
    } | undefined;
    if (!row) return undefined;
    return {
      ref: { algorithm: row.algorithm, hash: row.hash, sizeBytes: row.size_bytes },
      detectedMimeType: row.detected_mime_type ?? undefined,
      effectiveMimeType: row.effective_mime_type,
      createdAt: row.created_at,
    };
  }

  async blobExists(ref: BlobRef): Promise<boolean> {
    const row = this.db.prepare(`
      SELECT 1 FROM artifact_blobs WHERE algorithm = ? AND hash = ? AND size_bytes = ?
    `).get(ref.algorithm, ref.hash, ref.sizeBytes) as { 1: number } | undefined;
    return row !== undefined;
  }

  async readBlob(ref: BlobRef): Promise<Uint8Array> {
    const row = this.db.prepare(`
      SELECT bytes FROM artifact_blobs WHERE algorithm = ? AND hash = ? AND size_bytes = ?
    `).get(ref.algorithm, ref.hash, ref.sizeBytes) as { bytes: Uint8Array | Buffer } | undefined;
    if (!row) throw new Error(`Blob not found: ${ref.hash}`);
    return new Uint8Array(row.bytes);
  }

  async readBlobRange(ref: BlobRef, offset: number, length: number): Promise<Uint8Array> {
    validateBlobRange(ref, offset, length);
    const row = this.db.prepare(`
      SELECT substr(bytes, ? + 1, ?) AS bytes
      FROM artifact_blobs
      WHERE algorithm = ? AND hash = ? AND size_bytes = ?
    `).get(offset, length, ref.algorithm, ref.hash, ref.sizeBytes) as { bytes: Uint8Array | Buffer } | undefined;
    if (!row) throw new Error(`Blob not found: ${ref.hash}`);
    return new Uint8Array(row.bytes);
  }
}

function validateBlobRange(ref: BlobRef, offset: number, length: number): void {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error(`Invalid blob range offset: ${offset}`);
  }
  if (!Number.isInteger(length) || length < 0) {
    throw new Error(`Invalid blob range length: ${length}`);
  }
  if (offset + length > ref.sizeBytes) {
    throw new Error(`Blob range out of bounds: offset=${offset}, length=${length}, sizeBytes=${ref.sizeBytes}`);
  }
}

export function createBlobRef(bytes: Uint8Array): BlobRef {
  return {
    algorithm: "sha256",
    hash: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.byteLength,
  };
}

export function clone<T>(value: T): T {
  return cloneJsonValue(value);
}

export function toBlobKey(ref: BlobRef): string {
  return `${ref.algorithm}:${ref.hash}:${ref.sizeBytes}`;
}

export function matchesBlobRef(left: BlobRef, right: BlobRef): boolean {
  return left.algorithm === right.algorithm && left.hash === right.hash && left.sizeBytes === right.sizeBytes;
}

export function inlineResult(value: JsonValue): JsonValue {
  return toInlineJsonPreview(value, { maxBytes: ARTIFACT_INLINE_RESULT_MAX_BYTES });
}

export function canonicalizeJsonValue(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((entry) => canonicalizeJsonValue(entry)) as JsonValue;
  const objectValue = value as Record<string, JsonValue>;
  const result: Record<string, JsonValue> = {};
  for (const key of Object.keys(objectValue).sort()) {
    const entry = objectValue[key];
    if (entry !== undefined) result[key] = canonicalizeJsonValue(entry);
  }
  return result as JsonValue;
}

export function stableJsonStringify(value: JsonValue): string {
  return JSON.stringify(canonicalizeJsonValue(value));
}

function mimeFromFilename(filename: string | undefined): string | undefined {
  if (!filename) return undefined;
  switch (extname(filename).toLowerCase()) {
    case ".json": return "application/json";
    case ".txt": return "text/plain";
    case ".md": return "text/markdown";
    case ".pdf": return "application/pdf";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".wav": return "audio/wav";
    case ".mp3": return "audio/mpeg";
    case ".ogg": return "audio/ogg";
    case ".mp4": return "video/mp4";
    case ".m4a": return "audio/mp4";
    case ".docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case ".xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".csv": return "text/csv";
    case ".tsv": return "text/tsv";
    default: return undefined;
  }
}

function looksLikeUtf8Text(bytes: Uint8Array): boolean {
  try {
    fatalUtf8TextDecoder.decode(bytes);
    return !bytes.some((byte) => byte === 0);
  } catch {
    return false;
  }
}

export function resolveMimeType(bytes: Uint8Array, declaredMimeType?: string, filename?: string): {
  readonly detectedMimeType?: string;
  readonly effectiveMimeType: string;
} {
  const header = Buffer.from(bytes.subarray(0, 16));
  const filenameMime = mimeFromFilename(filename);
  const preferredMime = declaredMimeType ?? filenameMime;
  let detectedMimeType: string | undefined;
  if (header.subarray(0, 5).toString("utf8") === "%PDF-") detectedMimeType = "application/pdf";
  else if (header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) detectedMimeType = "image/png";
  else if (header.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) detectedMimeType = "image/jpeg";
  else if (header.subarray(0, 6).toString("ascii") === "GIF87a" || header.subarray(0, 6).toString("ascii") === "GIF89a") detectedMimeType = "image/gif";
  else if (header.subarray(8, 12).toString("ascii") === "WEBP") detectedMimeType = "image/webp";
  else if (header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WAVE") detectedMimeType = "audio/wav";
  else if (header.subarray(0, 3).toString("ascii") === "ID3") detectedMimeType = "audio/mpeg";
  else if (header.subarray(0, 4).toString("ascii") === "OggS") detectedMimeType = "audio/ogg";
  else if (header.subarray(4, 8).toString("ascii") === "ftyp") detectedMimeType = filenameMime === "audio/mp4" ? "audio/mp4" : "video/mp4";
  else if (header.subarray(0, 2).equals(Buffer.from([0x50, 0x4b]))) detectedMimeType = filenameMime;
  else if ((declaredMimeType === "application/json" || filenameMime === "application/json") && looksLikeUtf8Text(bytes)) {
    try {
      JSON.parse(textDecoder.decode(bytes));
      detectedMimeType = "application/json";
    } catch {
      // ignore JSON parse failure
    }
  } else if (looksLikeUtf8Text(bytes) && preferredMime === undefined) detectedMimeType = filenameMime?.startsWith("text/") ? filenameMime : "text/plain";
  return { detectedMimeType, effectiveMimeType: detectedMimeType ?? preferredMime ?? "application/octet-stream" };
}

export const isJsonObject = sharedIsJsonObject;

export function isSupportedTextMime(mimeType: string): boolean {
  return mimeType.startsWith("text/") || mimeType === "application/json" || mimeType.endsWith("+json");
}

export function isSupportedBinaryPreviewMime(mimeType: string): boolean {
  return mimeType.startsWith("image/") || mimeType === "application/pdf" || mimeType === "application/octet-stream";
}

export function isSupportedJsonMime(mimeType: string): boolean {
  return mimeType === "application/json" || mimeType.endsWith("+json");
}

export function artifactError(category: ArtifactErrorCategory, message: string, details?: JsonValue): ArtifactErrorResult {
  return {
    type: "error",
    error: { category, message, ...(details === undefined ? {} : { details }) },
  } as ArtifactErrorResult;
}

export function blobRefToJson(ref: BlobRef): JsonValue {
  return { algorithm: ref.algorithm, hash: ref.hash, sizeBytes: ref.sizeBytes };
}

export function blobDescriptorToJson(descriptor: BlobDescriptor): JsonValue {
  return {
    ref: blobRefToJson(descriptor.ref),
    ...(descriptor.detectedMimeType ? { detectedMimeType: descriptor.detectedMimeType } : {}),
    effectiveMimeType: descriptor.effectiveMimeType,
    createdAt: descriptor.createdAt,
  };
}

export function blobDescriptorSummary(descriptor: BlobDescriptor) {
  return {
    ref: `${descriptor.ref.algorithm}:${descriptor.ref.hash}`,
    sizeBytes: descriptor.ref.sizeBytes,
    effectiveMimeType: descriptor.effectiveMimeType,
    createdAt: descriptor.createdAt,
  };
}

export function normalizeBlobDescriptor(descriptor: BlobDescriptor): BlobDescriptor {
  return {
    ref: descriptor.ref,
    ...(descriptor.detectedMimeType === undefined ? {} : { detectedMimeType: descriptor.detectedMimeType }),
    effectiveMimeType: descriptor.effectiveMimeType,
    createdAt: descriptor.createdAt,
  };
}

export function toStateRecord(state: ArtifactActorState, descriptor: BlobDescriptor): ArtifactActorState {
  return {
    registeredCount: state.registeredCount + 1,
    lastRegisteredAt: descriptor.createdAt,
  };
}

export function decodeBase64(base64: string): Uint8Array | undefined {
  try {
    const normalized = base64.trim();
    if (normalized.length === 0 || normalized.length % 4 !== 0 || /[^A-Za-z0-9+/=]/u.test(normalized)) return undefined;
    return new Uint8Array(Buffer.from(normalized, "base64"));
  } catch {
    return undefined;
  }
}

export function blobRefSchemaDefault(): JsonValue {
  return { algorithm: "sha256", hash: "<paste-existing-blob-hash>", sizeBytes: 123 };
}

export function artifactRefSchemaDefault(): JsonValue {
  return {
    artifactId: "<paste-existing-artifact-id>",
    blob: blobRefSchemaDefault(),
  };
}

export function blobRefInputSchema(): JsonValue {
  return {
    type: "object",
    required: ["algorithm", "hash", "sizeBytes"],
    additionalProperties: false,
    properties: {
      algorithm: { const: "sha256" },
      hash: { type: "string" },
      sizeBytes: { type: "integer", minimum: 0 },
    },
  };
}

export function artifactRefInputSchema(): JsonValue {
  return {
    type: "object",
    required: ["artifactId", "blob"],
    additionalProperties: false,
    properties: {
      artifactId: { type: "string" },
      blob: blobRefInputSchema(),
    },
  } as JsonValue;
}

export async function readArtifactBytesResult(storage: ArtifactStorage, ref: ArtifactRef, offsetBytes: number, lengthBytes: number): Promise<ArtifactReadBytesCompleted["result"]> {
  if (!Number.isInteger(offsetBytes) || !Number.isInteger(lengthBytes)) return artifactError("invalidRequest", "offsetBytes and lengthBytes must be integers.");
  if (offsetBytes < 0 || lengthBytes < 0) return artifactError("invalidRequest", "offsetBytes and lengthBytes must be non-negative integers.", { offsetBytes, lengthBytes });
  if (lengthBytes > MAX_ARTIFACT_READ_BYTES) {
    return artifactError("readTooLarge", `lengthBytes cannot exceed ${MAX_ARTIFACT_READ_BYTES} bytes.`, { lengthBytes, maxAllowedBytes: MAX_ARTIFACT_READ_BYTES });
  }
  const artifact = await storage.getArtifact(ref);
  if (!artifact) return artifactError("artifactMissing", `Artifact '${ref.artifactId}' was not found.`, { ref: ref as unknown as JsonValue });
  const totalSizeBytes = artifact.blob.sizeBytes;
  if (offsetBytes > totalSizeBytes || offsetBytes + lengthBytes > totalSizeBytes) {
    return artifactError("rangeOutOfBounds", "Requested byte range is outside the artifact bounds.", { offsetBytes, lengthBytes, totalSizeBytes });
  }
  let bytes: Uint8Array;
  try {
    bytes = await storage.readBlobRange(artifact.blob, offsetBytes, lengthBytes);
  } catch {
    return artifactError("storageInconsistent", `Artifact '${ref.artifactId}' descriptor exists, but stored bytes were not found.`);
  }
  return { type: "ok", bytesBase64: Buffer.from(bytes).toString("base64"), offset: offsetBytes, length: lengthBytes, totalSizeBytes };
}

export function createRequestId(prefix: string, nextRequestNumber: number, explicit?: string): string {
  return explicit ?? `${prefix}~${nextRequestNumber}`;
}

export function decodeReadBytesResult(result: ArtifactReadBytesOk): Uint8Array {
  return new Uint8Array(Buffer.from(result.bytesBase64, "base64"));
}

export function readerDescriptors(): readonly JsonValue[] {
  return [
    { readerPath: "/aven/system/artifact-readers/bytes", title: "Bytes reader", operationIds: ["readBytes"] },
    { readerPath: "/aven/system/artifact-readers/text", title: "Text reader", operationIds: ["readTextPreview", "readTextRange"] },
    { readerPath: "/aven/system/artifact-readers/json", title: "JSON reader", operationIds: ["parseJson"] },
  ];
}

export function compatibleReadersForDescriptor(descriptor: Pick<ArtifactDescriptor, "effectiveMimeType"> | Pick<BlobDescriptor, "effectiveMimeType">): readonly JsonValue[] {
  const results: JsonValue[] = [{ readerPath: "/aven/system/artifact-readers/bytes", operationId: "readBytes", compatible: true }];
  if (isSupportedTextMime(descriptor.effectiveMimeType)) results.push({ readerPath: "/aven/system/artifact-readers/text", operationId: "readTextPreview", compatible: true });
  if (isSupportedJsonMime(descriptor.effectiveMimeType)) results.push({ readerPath: "/aven/system/artifact-readers/json", operationId: "parseJson", compatible: true });
  return results;
}

export function replyTarget(replyTo: ReplyAddress) {
  return { id: ActorId.parse(replyTo.actorId), kind: replyTo.actorKind as never };
}

export function cleanupPendingMap<T extends { readonly deadlineAt: string }>(pendingByRequestId: Readonly<Record<string, T>>, now: Date): {
  readonly nextPending: Record<string, T>;
  readonly expiredRequestIds: string[];
} {
  const nextPending: Record<string, T> = {};
  const expiredRequestIds: string[] = [];
  for (const [requestId, pending] of Object.entries(pendingByRequestId)) {
    if (isExpired(pending.deadlineAt, now)) expiredRequestIds.push(requestId);
    else nextPending[requestId] = pending;
  }
  return { nextPending, expiredRequestIds };
}

export function cleanupPendingResult(expiredRequestIds: readonly string[], remainingPendingCount: number): JsonValue {
  return inlineResult({ type: "ok", cleanedUpCount: expiredRequestIds.length, expiredRequestIds, remainingPendingCount } as unknown as JsonValue);
}

export function pendingDeadline(now: Date): string {
  return deadlineAfter(now, ARTIFACT_PENDING_TTL_MS);
}

export function childReaders(ActorKind: typeof import("../../runtime/src/spine.ts").ActorKind) {
  return [
    { path: "bytes", title: "bytes", actorKind: ActorKind.ByteArtifactReader },
    { path: "text", title: "text", actorKind: ActorKind.TextArtifactReader },
    { path: "json", title: "json", actorKind: ActorKind.JsonArtifactReader },
  ] as const;
}
