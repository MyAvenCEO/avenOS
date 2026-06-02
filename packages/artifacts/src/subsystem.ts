import {
  ActorId,
  openAvenSqliteDatabase,
  type AvenSqliteDatabase,
  type ActorContext,
  type ActorDefinitionMap,
  type JsonValue,
} from "typed-actors";
import { type ActorTreePresentationMap } from "typed-actors-introspection";
import type {
  ArtifactExistsCompleted,
  ArtifactExistsRequest,
  ArtifactGetDescriptorCompleted,
  ArtifactGetDescriptorRequest,
  ArtifactReadBytesCompleted,
  ArtifactReadBytesError,
  ArtifactReadBytesOk,
  ArtifactReadBytesRequest,
  BlobDescriptor,
  BlobRef,
} from "artifact-contracts";
import type { ArtifactActorMessage, ArtifactActorState, ArtifactReaderRegistryMessage, ArtifactReaderRegistryState, ByteArtifactReaderMessage, ByteArtifactReaderState, JsonArtifactReaderMessage, JsonArtifactReaderState, PendingTextRead, TextArtifactReaderMessage, TextArtifactReaderState } from "./actors/artifact/types.ts";
import type { DebugMessageDescriptor, AvenRegistry } from "../../runtime/src/spine.ts";
import type { ReplyAddress } from "shared";
import type { CleanupExpiredPendingMessage } from "./messages/cleanup-expired-pending.ts";
import type { ListCompatibleReadersMessage } from "./messages/list-compatible-readers.ts";
import type { ListReadersMessage } from "./messages/list-readers.ts";
import type { ParseJsonMessage } from "./messages/parse-json.ts";
import type { PutBase64Message } from "./messages/put-base64.ts";
import type { PutJsonMessage } from "./messages/put-json.ts";
import type { PutTextMessage } from "./messages/put-text.ts";
import type { ReadBytesMessage } from "./messages/read-bytes.ts";
import type { ReadTextPreviewMessage } from "./messages/read-text-preview.ts";
import type { ReadTextRangeMessage } from "./messages/read-text-range.ts";
import { ArtifactActor } from "./actors/artifact/actor.ts";
import { ArtifactReaderRegistryActor } from "./actors/reader-registry/actor.ts";
import { ByteArtifactReaderActor } from "./actors/byte-reader/actor.ts";
import { JsonArtifactReaderActor } from "./actors/json-reader/actor.ts";
import { TextArtifactReaderActor } from "./actors/text-reader/actor.ts";
import {
  DEFAULT_PREVIEW_MAX_CHARS,
  MAX_ARTIFACT_READ_BYTES,
  MAX_JSON_ARTIFACT_BYTES,
  type ArtifactStorage,
  SqliteArtifactStorage,
  artifactRefInputSchema,
  artifactError,
  blobDescriptorSummary,
  blobDescriptorToJson,
  cleanupPendingMap,
  cleanupPendingResult,
  clone,
  createRequestId,
  decodeBase64,
  decodeReadBytesResult,
  isJsonObject,
  isSupportedJsonMime,
  isSupportedTextMime,
  pendingDeadline,
  readArtifactBytesResult,
  readerDescriptors,
  replyTarget,
  stableJsonStringify,
  textDecoder,
  textEncoder,
  toStateRecord,
  compatibleReadersForDescriptor,
} from "./storage.ts";
import {
  artifactDebugMessageDescriptors,
  artifactReaderDebugMessageDescriptors,
} from "./operations.ts";

export type {
  ArtifactActorMessage,
  ArtifactActorState,
  ArtifactReaderRegistryMessage,
  ArtifactReaderRegistryState,
  ByteArtifactReaderMessage,
  ByteArtifactReaderState,
  JsonArtifactReaderMessage,
  JsonArtifactReaderState,
  PendingTextRead,
  TextArtifactReaderMessage,
  TextArtifactReaderState,
} from "./actors/artifact/types.ts";

export type { ArtifactStorage, ArtifactWrite } from "./storage.ts";
export { SqliteArtifactStorage } from "./storage.ts";
export { artifactDebugMessageDescriptors, artifactReaderDebugMessageDescriptors } from "./operations.ts";
export type {
  ArtifactExistsCompleted,
  ArtifactExistsRequest,
  ArtifactGetDescriptorCompleted,
  ArtifactGetDescriptorRequest,
  ArtifactReadBytesCompleted,
  ArtifactReadBytesRequest,
  BlobDescriptor,
  BlobRef,
} from "artifact-contracts";

export type ArtifactRuntimeActorKind = typeof import("../../runtime/src/spine.ts").ActorKind;

export interface BuildArtifactSubsystemArgs {
  readonly registry: AvenRegistry;
  readonly ActorKind: ArtifactRuntimeActorKind;
  readonly storage?: ArtifactStorage;
  readonly sqliteDb?: AvenSqliteDatabase;
}

export interface ArtifactSubsystemSupport {
  readonly registry: AvenRegistry;
  readonly ActorKind: ArtifactRuntimeActorKind;
  readonly storage: ArtifactStorage;
  readonly textEncoder: typeof textEncoder;
  readonly textDecoder: typeof textDecoder;
  readonly DEFAULT_PREVIEW_MAX_CHARS: number;
  readonly MAX_ARTIFACT_READ_BYTES: number;
  readonly MAX_JSON_ARTIFACT_BYTES: number;
  readonly clone: typeof clone;
  readonly artifactError: typeof artifactError;
  readonly toStateRecord: typeof toStateRecord;
  readonly readArtifactBytesResult: typeof readArtifactBytesResult;
  readonly blobDescriptorToJson: typeof blobDescriptorToJson;
  readonly blobDescriptorSummary: typeof blobDescriptorSummary;
  readonly stableJsonStringify: typeof stableJsonStringify;
  readonly decodeBase64: typeof decodeBase64;
  readonly readerDescriptors: typeof readerDescriptors;
  readonly compatibleReadersForDescriptor: typeof compatibleReadersForDescriptor;
  readonly cleanupPendingMap: typeof cleanupPendingMap;
  readonly cleanupPendingResult: typeof cleanupPendingResult;
  readonly pendingDeadline: typeof pendingDeadline;
  readonly createRequestId: typeof createRequestId;
  readonly decodeReadBytesResult: typeof decodeReadBytesResult;
  readonly replyTarget: typeof replyTarget;
  readonly isSupportedTextMime: typeof isSupportedTextMime;
  readonly isSupportedJsonMime: typeof isSupportedJsonMime;
  readonly isJsonObject: typeof isJsonObject;
}

function createArtifactSubsystemSupport(args: BuildArtifactSubsystemArgs): ArtifactSubsystemSupport {
  const { registry, ActorKind } = args;
  const storage = args.storage ?? new SqliteArtifactStorage(args.sqliteDb ?? openAvenSqliteDatabase("./aven-runtime.db"));
  return {
    registry,
    ActorKind,
    storage,
    textEncoder,
    textDecoder,
    DEFAULT_PREVIEW_MAX_CHARS,
    MAX_ARTIFACT_READ_BYTES,
    MAX_JSON_ARTIFACT_BYTES,
    clone,
    artifactError,
    toStateRecord,
    readArtifactBytesResult,
    blobDescriptorToJson,
    blobDescriptorSummary,
    stableJsonStringify,
    decodeBase64,
    readerDescriptors,
    compatibleReadersForDescriptor,
    cleanupPendingMap,
    cleanupPendingResult,
    pendingDeadline,
    createRequestId,
    decodeReadBytesResult,
    replyTarget,
    isSupportedTextMime,
    isSupportedJsonMime,
    isJsonObject,
  };
}

export function buildArtifactSubsystemBundle(args: BuildArtifactSubsystemArgs) {
  return {
    definitions: buildArtifactSubsystemDefinitions(args),
    presentations: buildArtifactSubsystemPresentations(args),
  } as const;
}

export function buildArtifactSubsystemDefinitions(args: BuildArtifactSubsystemArgs) {
  const { registry, ActorKind } = args;
  const support = createArtifactSubsystemSupport(args);
  return {
    [ActorKind.Artifacts]: new ArtifactActor(support).buildDefinition(),
    [ActorKind.ArtifactReaderRegistry]: new ArtifactReaderRegistryActor(support).buildDefinition(),
    [ActorKind.ByteArtifactReader]: new ByteArtifactReaderActor(support).buildDefinition(),
    [ActorKind.TextArtifactReader]: new TextArtifactReaderActor(support).buildDefinition(),
    [ActorKind.JsonArtifactReader]: new JsonArtifactReaderActor(support).buildDefinition(),
  } satisfies Pick<ActorDefinitionMap<typeof registry>, typeof ActorKind.Artifacts | typeof ActorKind.ArtifactReaderRegistry | typeof ActorKind.ByteArtifactReader | typeof ActorKind.TextArtifactReader | typeof ActorKind.JsonArtifactReader>;
}


export function buildArtifactSubsystemPresentations(_args: BuildArtifactSubsystemArgs): ActorTreePresentationMap<AvenRegistry> {
  return {};
}
