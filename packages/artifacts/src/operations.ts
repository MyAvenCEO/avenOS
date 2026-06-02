import type { JsonValue } from "typed-actors";
import type { DebugMessageDescriptor } from "../../runtime/src/spine.ts";
import {
  artifactRefInputSchema,
  artifactRefSchemaDefault,
  blobRefInputSchema,
  blobRefSchemaDefault,
  DEFAULT_PREVIEW_MAX_CHARS,
  MAX_ARTIFACT_READ_BYTES,
} from "./storage.ts";

const putTextSchema = {
  title: "Put text",
  description: "UTF-8 encode text and store it as an immutable blob.",
  type: "object",
  required: ["text"],
  additionalProperties: false,
  properties: {
    text: { type: "string" },
    declaredMimeType: { type: "string" },
    filename: { type: "string" },
  },
  default: { text: "hello artifact world", declaredMimeType: "text/plain", filename: "hello.txt" },
  examples: [{ text: "hello artifact world", declaredMimeType: "text/plain", filename: "hello.txt" }],
};
const putJsonSchema = {
  title: "Put JSON",
  description: "Stable-stringify JSON and store it as an immutable blob.",
  type: "object",
  required: ["value"],
  additionalProperties: false,
  properties: { value: {}, filename: { type: "string" } },
  default: { value: { hello: "world" }, filename: "hello.json" },
  examples: [{ value: { hello: "world" }, filename: "hello.json" }],
};
const putBase64Schema = {
  title: "Put base64",
  description: "Decode base64 and store the decoded bytes as an immutable blob.",
  type: "object",
  required: ["base64"],
  additionalProperties: false,
  properties: { base64: { type: "string" }, declaredMimeType: { type: "string" }, filename: { type: "string" } },
  default: { base64: "aGVsbG8=", declaredMimeType: "text/plain", filename: "hello.txt" },
  examples: [{ base64: "aGVsbG8=", declaredMimeType: "text/plain", filename: "hello.txt" }],
};
export const listReadersDescriptor: DebugMessageDescriptor = { id: "listReaders", actorKind: "artifactReaderRegistry", title: "List readers", description: "List available artifact readers.", messageType: "listReaders", schema: { type: "object", additionalProperties: false, default: {} }, defaultValue: {} };
export const listCompatibleReadersDescriptor: DebugMessageDescriptor = { id: "listCompatibleReaders", actorKind: "artifactReaderRegistry", title: "List compatible readers", description: "List readers compatible with an artifact ref.", messageType: "listCompatibleReaders", schema: { type: "object", additionalProperties: false, required: ["ref"], properties: { ref: artifactRefInputSchema() }, default: { ref: artifactRefSchemaDefault() }, examples: [{ ref: artifactRefSchemaDefault() }] }, defaultValue: { ref: artifactRefSchemaDefault() } };
export const readBytesDescriptor: DebugMessageDescriptor = { id: "readBytes", actorKind: "byteArtifactReader", title: "Read bytes", description: "Read a bounded byte range as base64.", messageType: "readBytes", schema: { type: "object", required: ["ref", "offsetBytes", "lengthBytes"], additionalProperties: false, properties: { ref: artifactRefInputSchema(), offsetBytes: { type: "integer", minimum: 0 }, lengthBytes: { type: "integer", minimum: 0, maximum: MAX_ARTIFACT_READ_BYTES } }, default: { ref: artifactRefSchemaDefault(), offsetBytes: 0, lengthBytes: 64 }, examples: [{ ref: artifactRefSchemaDefault(), offsetBytes: 0, lengthBytes: 64 }] } as JsonValue, defaultValue: { ref: artifactRefSchemaDefault(), offsetBytes: 0, lengthBytes: 64 } };
export const readTextPreviewDescriptor: DebugMessageDescriptor = { id: "readTextPreview", actorKind: "textArtifactReader", title: "Read text preview", description: "Read a bounded UTF-8 preview from text-compatible artifacts.", messageType: "readTextPreview", schema: { type: "object", required: ["ref", "maxChars"], additionalProperties: false, properties: { ref: artifactRefInputSchema(), maxChars: { type: "integer", minimum: 1, maximum: DEFAULT_PREVIEW_MAX_CHARS } }, default: { ref: artifactRefSchemaDefault(), maxChars: 512 }, examples: [{ ref: artifactRefSchemaDefault(), maxChars: 512 }] } as JsonValue, defaultValue: { ref: artifactRefSchemaDefault(), maxChars: 512 } };
export const readTextRangeDescriptor: DebugMessageDescriptor = { id: "readTextRange", actorKind: "textArtifactReader", title: "Read text range", description: "Read a bounded UTF-8 byte range from text-compatible artifacts.", messageType: "readTextRange", schema: { type: "object", required: ["ref", "offsetBytes", "lengthBytes"], additionalProperties: false, properties: { ref: artifactRefInputSchema(), offsetBytes: { type: "integer", minimum: 0 }, lengthBytes: { type: "integer", minimum: 1, maximum: MAX_ARTIFACT_READ_BYTES } }, default: { ref: artifactRefSchemaDefault(), offsetBytes: 0, lengthBytes: 512 }, examples: [{ ref: artifactRefSchemaDefault(), offsetBytes: 0, lengthBytes: 512 }] } as JsonValue, defaultValue: { ref: artifactRefSchemaDefault(), offsetBytes: 0, lengthBytes: 512 } };
export const parseJsonDescriptor: DebugMessageDescriptor = { id: "parseJson", actorKind: "jsonArtifactReader", title: "Parse JSON", description: "Read a bounded JSON artifact, decode UTF-8, and parse the value.", messageType: "parseJson", schema: { type: "object", required: ["ref"], additionalProperties: false, properties: { ref: artifactRefInputSchema() }, default: { ref: artifactRefSchemaDefault() }, examples: [{ ref: artifactRefSchemaDefault() }] } as JsonValue, defaultValue: { ref: artifactRefSchemaDefault() } };
export const cleanupExpiredPendingDescriptor: DebugMessageDescriptor = { id: "cleanupExpiredPending", actorKind: "artifactReaderRegistry", title: "Cleanup expired pending", description: "Remove stale pending artifact-reader requests that exceeded their deadline.", messageType: "cleanupExpiredPending", schema: { type: "object", additionalProperties: false, default: {} }, defaultValue: {} };
export const artifactDebugMessageDescriptors: readonly DebugMessageDescriptor[] = [
  { id: "putText", actorKind: "artifacts", title: putTextSchema.title, description: putTextSchema.description, messageType: "putText", schema: putTextSchema as JsonValue, defaultValue: putTextSchema.default as JsonValue },
  { id: "putJson", actorKind: "artifacts", title: putJsonSchema.title, description: putJsonSchema.description, messageType: "putJson", schema: putJsonSchema as JsonValue, defaultValue: putJsonSchema.default as JsonValue },
  { id: "putBase64", actorKind: "artifacts", title: putBase64Schema.title, description: putBase64Schema.description, messageType: "putBase64", schema: putBase64Schema as JsonValue, defaultValue: putBase64Schema.default as JsonValue },
];
export const artifactReaderDebugMessageDescriptors: readonly DebugMessageDescriptor[] = [listReadersDescriptor, listCompatibleReadersDescriptor, cleanupExpiredPendingDescriptor, readBytesDescriptor, readTextPreviewDescriptor, readTextRangeDescriptor, parseJsonDescriptor];
