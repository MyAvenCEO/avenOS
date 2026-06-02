import { ActorId, buildActorDefinition, type ActorContextWithRuntime, type ActorDefinitionMap } from "typed-actors";
import type { ArtifactRef } from "artifact-contracts";
import type { LlmRequest, LlmRequestCompleted } from "llm-contracts";
import type { CreateMetadataRecordMessage, MetadataRecordCompleted } from "metadata-contracts";
import { getBundledSchemaBinding, getCurrentDefaultExtractionSchemaRef, getDefaultExtractionSchemaCatalogEntry } from "schema";
import type { SchemaRef } from "schema-contracts";
import type { ReplyAddress } from "shared";
import { toReplyAddress } from "shared";
import type {
  ExtractStructuredCompleted,
  ExtractStructuredRequest,
  StructuredExtractionResult,
} from "structured-extraction-contracts";
import type { AvenRegistry } from "../../../../runtime/src/spine.ts";
import type { StructuredExtractionSubsystemSupport } from "../../subsystem.ts";
import { structuredExtractionActorShape } from "./shape.ts";
import {
  buildExtractionPrompt,
  buildSchemaRepairPrompt,
  deterministicExtractionIdempotencyKey,
  effectiveRequirementsForKind,
  extractCandidateValueFromValidationDetails,
  inferStructuredExtractionArtifactKind,
  pruneJsonToSchema,
  structuredExtractionError,
} from "./support.ts";

type RuntimeActorKind = typeof import("../../../../runtime/src/spine.ts").ActorKind;

export interface PendingStructuredExtraction {
  readonly originalRequestId: string;
  readonly replyTo: ReplyAddress;
  readonly intentId: string;
  readonly artifact: ArtifactRef;
  readonly schemaRef: SchemaRef;
  readonly schemaJson?: import("typed-actors").JsonValue;
  readonly mediaRole: string;
  readonly llmPrompt: string;
  readonly instruction?: string;
  readonly repairAttemptCount?: number;
  readonly startedAt: string;
}

export interface PendingMetadataWrite {
  readonly originalRequestId: string;
  readonly replyTo: ReplyAddress;
  readonly artifact: ArtifactRef;
  readonly schemaRef: SchemaRef;
  readonly value: import("typed-actors").JsonValue;
  readonly startedAt: string;
}

export interface StructuredExtractionActorState {
  readonly pendingByLlmRequestId: Record<string, PendingStructuredExtraction>;
  readonly pendingByMetadataRequestId: Record<string, PendingMetadataWrite>;
}

export type StructuredExtractionActorMessage =
  | ExtractStructuredRequest
  | LlmRequestCompleted
  | MetadataRecordCompleted;

interface BuildExtractionLlmRequestInput {
  readonly callerActorId: string;
  readonly callerReplyTo: ReplyAddress;
  readonly originalRequestId: string;
  readonly replyTo: ReplyAddress;
  readonly intentId: string;
  readonly artifact: ArtifactRef;
  readonly schemaRef: SchemaRef;
  readonly schemaJson?: import("typed-actors").JsonValue;
  readonly mediaRole: string;
  readonly llmPrompt: string;
  readonly instruction?: string;
  readonly requirements: ExtractStructuredRequest["requirements"] | undefined;
  readonly repairAttemptCount?: number;
  readonly startedAt: string;
}

interface BuiltExtractionLlmRequest {
  readonly llmRequestId: string;
  readonly llmRequest: LlmRequest;
  readonly pending: PendingStructuredExtraction;
}

function reply(
  ctx: ActorContextWithRuntime<AvenRegistry, RuntimeActorKind["StructuredExtraction"], typeof structuredExtractionActorShape.messages, StructuredExtractionActorState>,
  replyTo: ReplyAddress,
  requestId: string,
  result: StructuredExtractionResult,
): void {
  ctx.send(
    { id: ActorId.parse(replyTo.actorId), kind: replyTo.actorKind as never },
    { type: "structuredExtractionCompleted", requestId, result } satisfies ExtractStructuredCompleted as never,
  );
}

export class StructuredExtractionActor {
  constructor(private readonly support: StructuredExtractionSubsystemSupport) {}

  private llmRequestId(input: { intentId: string; requestId: string; repairAttemptCount?: number }): string {
    const suffix = input.repairAttemptCount && input.repairAttemptCount > 0
      ? `~repair${input.repairAttemptCount}`
      : "";
    return `${input.intentId}~${input.requestId}~llm${suffix}`;
  }

  private buildExtractionLlmRequest(input: BuildExtractionLlmRequestInput): BuiltExtractionLlmRequest {
    const llmRequestId = this.llmRequestId({
      intentId: input.intentId,
      requestId: input.originalRequestId,
      repairAttemptCount: input.repairAttemptCount,
    });
    const llmRequest: LlmRequest = {
      type: "submitLlmRequest",
      requestId: llmRequestId,
      replyTo: input.callerReplyTo,
      responseSchema: this.support.clone(input.schemaRef),
      callerActorId: input.callerActorId,
      ...(input.requirements === undefined ? {} : { requirements: input.requirements }),
      input: {
        messages: [{
          role: "user",
          content: [
            { kind: "text", text: input.llmPrompt },
            { kind: "artifact", ref: this.support.clone(input.artifact), mediaRole: input.mediaRole },
          ],
        }],
      },
    };
    return {
      llmRequestId,
      llmRequest,
      pending: {
        originalRequestId: input.originalRequestId,
        replyTo: input.replyTo,
        intentId: input.intentId,
        artifact: this.support.clone(input.artifact),
        schemaRef: this.support.clone(input.schemaRef),
        ...(input.schemaJson === undefined ? {} : { schemaJson: this.support.clone(input.schemaJson) }),
        mediaRole: input.mediaRole,
        llmPrompt: input.llmPrompt,
        ...(input.instruction === undefined ? {} : { instruction: input.instruction }),
        ...(input.repairAttemptCount === undefined ? {} : { repairAttemptCount: input.repairAttemptCount }),
        startedAt: input.startedAt,
      },
    };
  }

  buildDefinition(): ActorDefinitionMap<AvenRegistry>[RuntimeActorKind["StructuredExtraction"]] {
    return buildActorDefinition<AvenRegistry, RuntimeActorKind["StructuredExtraction"], typeof structuredExtractionActorShape>(structuredExtractionActorShape, {
      kind: this.support.ActorKind.StructuredExtraction,
      receive: {
        active: async (ctx, message: StructuredExtractionActorMessage) => {
          if (message.type === "structuredExtractionRequest") {
            if (!message.replyTo || !message.requestId) {
              return;
            }
            const artifactInScope = message.scope.artifacts.find((artifact) => artifact.artifactId === message.artifactId);
            if (!artifactInScope) {
              reply(ctx as never, message.replyTo, message.requestId, {
                type: "error",
                error: structuredExtractionError(
                  "invalidRequest",
                  "STRUCTURED_EXTRACTION_ARTIFACT_NOT_IN_SCOPE",
                  `Artifact '${message.artifactId}' is not available in this intent scope.`,
                  { artifactId: message.artifactId, intentId: message.scope.intentId },
                ),
              });
              return;
            }
            const artifact = await this.support.storage.getArtifact(artifactInScope.ref);
            if (!artifact) {
              reply(ctx as never, message.replyTo, message.requestId, {
                type: "error",
                error: structuredExtractionError(
                  "artifactMissing",
                  "STRUCTURED_EXTRACTION_ARTIFACT_MISSING",
                  `Artifact '${message.artifactId}' was not found.`,
                  { artifactId: message.artifactId, ref: this.support.clone(artifactInScope.ref as never) },
                ),
              });
              return;
            }
            const schemaRef = getCurrentDefaultExtractionSchemaRef(message.schemaId);
            if (!schemaRef) {
              reply(ctx as never, message.replyTo, message.requestId, {
                type: "error",
                error: structuredExtractionError(
                  "schemaNotFound",
                  "STRUCTURED_EXTRACTION_SCHEMA_UNKNOWN",
                  `Unknown extraction schema '${message.schemaId}'.`,
                  { schemaId: message.schemaId },
                ),
              });
              return;
            }
            const schemaEntry = getDefaultExtractionSchemaCatalogEntry(schemaRef);
            const schemaBinding = getBundledSchemaBinding(schemaRef);
            const artifactKind = inferStructuredExtractionArtifactKind({
              effectiveMimeType: artifact.effectiveMimeType,
              filename: artifact.filename,
            });
            if (!artifactKind) {
              reply(ctx as never, message.replyTo, message.requestId, {
                type: "error",
                error: structuredExtractionError(
                  "modelCapability",
                  "STRUCTURED_EXTRACTION_ARTIFACT_KIND_UNSUPPORTED",
                  `Artifact '${message.artifactId}' is not supported for structured extraction.`,
                  { effectiveMimeType: artifact.effectiveMimeType, filename: artifact.filename ?? null },
                ),
              });
              return;
            }
            const llmPrompt = buildExtractionPrompt({
              schemaRef,
              schemaName: schemaEntry?.metadata.name,
              schemaDescription: schemaEntry?.metadata.description,
              schemaSystemPrompt: schemaEntry?.metadata.system_prompt,
              schemaJson: schemaBinding?.definition.schema,
              instruction: message.instruction,
            });
            const built = this.buildExtractionLlmRequest({
              callerActorId: ctx.self.id.toString(),
              callerReplyTo: toReplyAddress(ctx.self.id, this.support.ActorKind.StructuredExtraction),
              originalRequestId: message.requestId,
              replyTo: message.replyTo,
              intentId: message.scope.intentId,
              artifact: this.support.clone(artifactInScope.ref),
              schemaRef: this.support.clone(schemaRef),
              schemaJson: schemaBinding?.definition.schema,
              mediaRole: artifactKind,
              llmPrompt,
              instruction: message.instruction,
              requirements: effectiveRequirementsForKind(artifactKind, message.requirements),
              startedAt: ctx.now.toISOString(),
            });
            ctx.send({ id: this.support.llmsActorId, kind: this.support.ActorKind.Llms as never }, built.llmRequest as never);
            ctx.setState({
              ...ctx.state,
              pendingByLlmRequestId: {
                ...ctx.state.pendingByLlmRequestId,
                [built.llmRequestId]: built.pending,
              },
            });
            return;
          }

          if (message.type === "llmRequestCompleted") {
            const pending = ctx.state.pendingByLlmRequestId[message.requestId];
            if (!pending) return;
            const nextPendingByLlmRequestId = { ...ctx.state.pendingByLlmRequestId };
            delete nextPendingByLlmRequestId[message.requestId];
            if (message.result.type === "error") {
              if (message.result.error.category === "schemaInvalid" && (pending.repairAttemptCount ?? 0) < 1) {
                const built = this.buildExtractionLlmRequest({
                  callerActorId: ctx.self.id.toString(),
                  callerReplyTo: toReplyAddress(ctx.self.id, this.support.ActorKind.StructuredExtraction),
                  originalRequestId: pending.originalRequestId,
                  replyTo: pending.replyTo,
                  intentId: pending.intentId,
                  artifact: this.support.clone(pending.artifact),
                  schemaRef: this.support.clone(pending.schemaRef),
                  schemaJson: this.support.clone(pending.schemaJson),
                  mediaRole: pending.mediaRole,
                  llmPrompt: buildSchemaRepairPrompt({
                    basePrompt: pending.llmPrompt,
                    validationDetails: message.result.error.details,
                    previousCandidateValue: extractCandidateValueFromValidationDetails(message.result.error.details),
                  }),
                  instruction: pending.instruction,
                  requirements: undefined,
                  repairAttemptCount: (pending.repairAttemptCount ?? 0) + 1,
                  startedAt: pending.startedAt,
                });
                ctx.send({ id: this.support.llmsActorId, kind: this.support.ActorKind.Llms as never }, built.llmRequest as never);
                ctx.setState({
                  ...ctx.state,
                  pendingByLlmRequestId: {
                    ...nextPendingByLlmRequestId,
                    [built.llmRequestId]: built.pending,
                  },
                });
                return;
              }
              ctx.setState({ ...ctx.state, pendingByLlmRequestId: nextPendingByLlmRequestId });
              reply(ctx as never, pending.replyTo, pending.originalRequestId, {
                type: "error",
                error: structuredExtractionError(
                  message.result.error.category,
                  "STRUCTURED_EXTRACTION_LLM_FAILED",
                  message.result.error.message,
                  message.result.error.details,
                ),
              });
              return;
            }
            const jsonPart = message.result.output.find((part) => part.kind === "json");
            if (!jsonPart || jsonPart.kind !== "json") {
              ctx.setState({ ...ctx.state, pendingByLlmRequestId: nextPendingByLlmRequestId });
              reply(ctx as never, pending.replyTo, pending.originalRequestId, {
                type: "error",
                error: structuredExtractionError(
                  "outputInvalid",
                  "STRUCTURED_EXTRACTION_JSON_MISSING",
                  "Structured extraction did not return validated JSON.",
                ),
              });
              return;
            }
            const prunedValue = pruneJsonToSchema(
              this.support.clone(jsonPart.value),
              pending.schemaJson,
            );
            const metadataRequestId = `${pending.originalRequestId}~metadata`;
            const metadataRequest: CreateMetadataRecordMessage = {
              type: "createMetadataRecord",
              requestId: metadataRequestId,
              replyTo: toReplyAddress(ctx.self.id, this.support.ActorKind.StructuredExtraction),
              subject: { type: "artifact", ref: this.support.clone(pending.artifact) },
              schemaRef: this.support.clone(pending.schemaRef),
              value: this.support.clone(prunedValue),
              idempotencyKey: deterministicExtractionIdempotencyKey(pending.artifact, pending.schemaRef, pending.instruction),
            };
            ctx.send({ id: this.support.metadataActorId, kind: this.support.ActorKind.Metadata as never }, metadataRequest as never);
            ctx.setState({
              pendingByLlmRequestId: nextPendingByLlmRequestId,
              pendingByMetadataRequestId: {
                ...ctx.state.pendingByMetadataRequestId,
                [metadataRequestId]: {
                  originalRequestId: pending.originalRequestId,
                  replyTo: pending.replyTo,
                  artifact: this.support.clone(pending.artifact),
                  schemaRef: this.support.clone(pending.schemaRef),
                  value: this.support.clone(prunedValue),
                  startedAt: pending.startedAt,
                },
              },
            });
            return;
          }

          if (message.type === "metadataRecordCompleted") {
            const pending = ctx.state.pendingByMetadataRequestId[message.requestId];
            if (!pending) return;
            const nextPendingByMetadataRequestId = { ...ctx.state.pendingByMetadataRequestId };
            delete nextPendingByMetadataRequestId[message.requestId];
            ctx.setState({ ...ctx.state, pendingByMetadataRequestId: nextPendingByMetadataRequestId });
            if (message.result.type === "error") {
              reply(ctx as never, pending.replyTo, pending.originalRequestId, {
                type: "error",
                error: structuredExtractionError(
                  message.result.error.category === "schemaNotFound" ? "schemaNotFound" : "invalidRequest",
                  "STRUCTURED_EXTRACTION_METADATA_FAILED",
                  message.result.error.message,
                  message.result.error.details,
                ),
              });
              return;
            }
            reply(ctx as never, pending.replyTo, pending.originalRequestId, {
              type: "ok",
              artifact: this.support.clone(pending.artifact),
              schemaRef: this.support.clone(pending.schemaRef),
              value: this.support.clone(pending.value),
              metadataRecordId: message.result.record.recordId,
            });
          }
        },
      },
    });
  }
}