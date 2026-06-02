import { describe, expect, it } from "bun:test";
import { ActorId, InMemoryActorPersistence, actorType, createActorSystem, defineActor, defineRegistry } from "typed-actors";
import type { ArtifactDescriptor, ArtifactRef } from "artifact-contracts";
import type { LlmRequest, LlmRequestCompleted, LlmResult } from "llm-contracts";
import type { CreateMetadataRecordMessage, MetadataRecordCompleted } from "metadata-contracts";
import { getCurrentDefaultExtractionSchemaRef } from "schema";
import { buildStructuredExtractionSubsystemDefinitions } from "../src/subsystem.ts";

const ActorKind = {
  StructuredExtraction: "structuredExtraction",
  Llms: "llms",
  Metadata: "metadata",
  Capture: "capture",
} as const;

const registry = defineRegistry({
  [ActorKind.StructuredExtraction]: actorType<import("../src/subsystem.ts").StructuredExtractionActorState, import("../src/subsystem.ts").StructuredExtractionActorMessage, {}, "active", never>(),
  [ActorKind.Llms]: actorType<{ readonly requests: readonly LlmRequest[] }, LlmRequest, {}, "active", never>(),
  [ActorKind.Metadata]: actorType<{ readonly requests: readonly CreateMetadataRecordMessage[] }, CreateMetadataRecordMessage, {}, "active", never>(),
  [ActorKind.Capture]: actorType<{ readonly messages: readonly unknown[] }, unknown, {}, "active", never>(),
});

class MemoryArtifactStorage {
  constructor(private readonly artifacts: Readonly<Record<string, ArtifactDescriptor>>) {}

  async getArtifact(ref: ArtifactRef): Promise<ArtifactDescriptor | undefined> {
    const artifact = this.artifacts[ref.artifactId];
    if (!artifact) return undefined;
    return artifact.blob.hash === ref.blob.hash && artifact.blob.sizeBytes === ref.blob.sizeBytes
      ? artifact
      : undefined;
  }
}

function makeArtifact(args: { artifactId: string; mime: string; filename: string; sizeBytes?: number }): ArtifactDescriptor {
  return {
    artifactId: args.artifactId,
    blob: { algorithm: "sha256", hash: `${args.artifactId}-hash`, sizeBytes: args.sizeBytes ?? 10 },
    effectiveMimeType: args.mime,
    declaredMimeType: args.mime,
    filename: args.filename,
    createdAt: "2026-06-01T00:00:00.000Z",
  };
}

function validInvoiceValue(overrides?: Record<string, unknown>) {
  return {
    vendor: { name: "Vendor Co" },
    buyer: { name: "Buyer Co" },
    header: { document_kind: "invoice", invoice_number: "INV-1" },
    statements: [],
    ...(overrides ?? {}),
  };
}

async function createSystem(artifacts: Readonly<Record<string, ArtifactDescriptor>>) {
  const definitions = buildStructuredExtractionSubsystemDefinitions({
    registry,
    ActorKind: ActorKind as never,
    storage: new MemoryArtifactStorage(artifacts) as never,
    llmsActorId: ActorId.root("llms"),
    metadataActorId: ActorId.root("metadata"),
  });
  const system = createActorSystem({
    registry,
    persistence: new InMemoryActorPersistence(),
    runtime: { concurrency: 2, idleBackoffMs: 1, activationTimeoutMs: 5_000, leaseMs: 30_000 },
    definitions: {
      ...definitions,
      [ActorKind.Llms]: defineActor<typeof registry, typeof ActorKind.Llms>({
        kind: ActorKind.Llms,
        init: () => ({ state: { requests: [] }, behavior: "active" as const }),
        receive: { active(ctx, message) { ctx.setState({ requests: [...ctx.state.requests, message] }); } },
      }),
      [ActorKind.Metadata]: defineActor<typeof registry, typeof ActorKind.Metadata>({
        kind: ActorKind.Metadata,
        init: () => ({ state: { requests: [] }, behavior: "active" as const }),
        receive: { active(ctx, message) { ctx.setState({ requests: [...ctx.state.requests, message] }); } },
      }),
      [ActorKind.Capture]: defineActor<typeof registry, typeof ActorKind.Capture>({
        kind: ActorKind.Capture,
        init: () => ({ state: { messages: [] }, behavior: "active" as const }),
        receive: { active(ctx, message) { ctx.setState({ messages: [...ctx.state.messages, message] }); } },
      }),
    },
  });
  const extractionRef = await system.createRoot(ActorKind.StructuredExtraction, { id: ActorId.root("structured-extraction"), init: {} });
  await system.createRoot(ActorKind.Llms, { id: ActorId.root("llms"), init: {} });
  await system.createRoot(ActorKind.Metadata, { id: ActorId.root("metadata"), init: {} });
  await system.createRoot(ActorKind.Capture, { id: ActorId.root("capture"), init: {} });
  await system.runUntilIdle();
  return { system, extractionRef };
}

function scopeFor(artifact: ArtifactDescriptor) {
  return {
    intentId: "intent~1",
    artifacts: [{
      artifactId: artifact.artifactId,
      ref: { artifactId: artifact.artifactId, blob: artifact.blob },
      filename: artifact.filename,
      declaredMimeType: artifact.declaredMimeType,
      effectiveMimeType: artifact.effectiveMimeType,
      mediaRole: "image",
    }],
  } as const;
}

async function captureMessages(system: Awaited<ReturnType<typeof createSystem>>["system"]) {
  const actor = await system.inspector.getActor(ActorId.parse("/capture"));
  return ((actor?.actor.state as { messages: unknown[] } | undefined)?.messages ?? []);
}

async function llmRequests(system: Awaited<ReturnType<typeof createSystem>>["system"]) {
  const actor = await system.inspector.getActor(ActorId.parse("/llms"));
  return ((actor?.actor.state as { requests: LlmRequest[] } | undefined)?.requests ?? []);
}

async function metadataRequests(system: Awaited<ReturnType<typeof createSystem>>["system"]) {
  const actor = await system.inspector.getActor(ActorId.parse("/metadata"));
  return ((actor?.actor.state as { requests: CreateMetadataRecordMessage[] } | undefined)?.requests ?? []);
}

describe("StructuredExtractionActor", () => {
  it("returns ARTIFACT_NOT_IN_SCOPE when artifactId is not in scope", async () => {
    const artifact = makeArtifact({ artifactId: "artifact-1", mime: "image/png", filename: "invoice.png" });
    const { system, extractionRef } = await createSystem({ [artifact.artifactId]: artifact });
    await system.send(extractionRef, {
      type: "structuredExtractionRequest",
      requestId: "req-1",
      replyTo: { actorId: "/capture", actorKind: ActorKind.Capture },
      artifactId: "missing",
      schemaId: "invoice",
      scope: scopeFor(artifact),
    } as never);
    await system.runUntilIdle();
    const messages = await captureMessages(system);
    expect(messages[0]).toMatchObject({ result: { type: "error", error: { code: "STRUCTURED_EXTRACTION_ARTIFACT_NOT_IN_SCOPE" } } });
  });

  it("returns ARTIFACT_MISSING when descriptor lookup fails", async () => {
    const artifact = makeArtifact({ artifactId: "artifact-1", mime: "image/png", filename: "invoice.png" });
    const { system, extractionRef } = await createSystem({});
    await system.send(extractionRef, {
      type: "structuredExtractionRequest",
      requestId: "req-1",
      replyTo: { actorId: "/capture", actorKind: ActorKind.Capture },
      artifactId: artifact.artifactId,
      schemaId: "invoice",
      scope: scopeFor(artifact),
    } as never);
    await system.runUntilIdle();
    const messages = await captureMessages(system);
    expect(messages[0]).toMatchObject({ result: { type: "error", error: { code: "STRUCTURED_EXTRACTION_ARTIFACT_MISSING" } } });
  });

  it("returns SCHEMA_UNKNOWN for unknown schema ids", async () => {
    const artifact = makeArtifact({ artifactId: "artifact-1", mime: "image/png", filename: "invoice.png" });
    const { system, extractionRef } = await createSystem({ [artifact.artifactId]: artifact });
    await system.send(extractionRef, {
      type: "structuredExtractionRequest",
      requestId: "req-1",
      replyTo: { actorId: "/capture", actorKind: ActorKind.Capture },
      artifactId: artifact.artifactId,
      schemaId: "unknown_schema",
      scope: scopeFor(artifact),
    } as never);
    await system.runUntilIdle();
    const messages = await captureMessages(system);
    expect(messages[0]).toMatchObject({ result: { type: "error", error: { code: "STRUCTURED_EXTRACTION_SCHEMA_UNKNOWN" } } });
  });

  it("sends an image LLM request with current invoice schema and structured output requirements", async () => {
    const artifact = makeArtifact({ artifactId: "artifact-1", mime: "image/png", filename: "invoice.png" });
    const { system, extractionRef } = await createSystem({ [artifact.artifactId]: artifact });
    await system.send(extractionRef, {
      type: "structuredExtractionRequest",
      requestId: "req-1",
      replyTo: { actorId: "/capture", actorKind: ActorKind.Capture },
      artifactId: artifact.artifactId,
      schemaId: "invoice",
      scope: scopeFor(artifact),
    } as never);
    await system.runUntilIdle();
    const [request] = await llmRequests(system);
    expect(request.responseSchema).toEqual(getCurrentDefaultExtractionSchemaRef("invoice"));
    expect(request.input.messages[0]?.content[1]).toMatchObject({ kind: "artifact", ref: { artifactId: "artifact-1" }, mediaRole: "image" });
    expect(request.requirements).toMatchObject({ general: { requires: ["structuredOutput"] } });
    const promptPart = request.input.messages[0]?.content[0];
    expect(promptPart).toMatchObject({ kind: "text" });
    const promptText = promptPart && "text" in promptPart ? promptPart.text : "";
    expect(promptText).toContain("schema invoice@1.1.0");
    expect(promptText).toContain("Always include top-level vendor, buyer, header, and statements.");
    expect(promptText).toContain("Use header.document_kind (not document_type)");
    expect(promptText).toContain("Put line items inside statements[*].line_items, not at the top level.");
    expect(promptText).toContain("Emit JSON numbers as numbers, not quoted strings.");
    expect(promptText).toContain("Schema JSON (authoritative; follow property names, nesting, required fields, enums, and additionalProperties exactly):");
    expect(promptText).toContain('"required": [');
    expect(promptText).toContain('"vendor"');
    expect(promptText).toContain('"buyer"');
    expect(promptText).toContain('"document_kind"');
  });

  it("sends pdf mediaRole for pdf artifacts", async () => {
    const artifact = makeArtifact({ artifactId: "artifact-1", mime: "application/pdf", filename: "invoice.pdf" });
    const { system, extractionRef } = await createSystem({ [artifact.artifactId]: artifact });
    await system.send(extractionRef, {
      type: "structuredExtractionRequest",
      requestId: "req-1",
      replyTo: { actorId: "/capture", actorKind: ActorKind.Capture },
      artifactId: artifact.artifactId,
      schemaId: "invoice",
      scope: scopeFor(artifact),
    } as never);
    await system.runUntilIdle();
    const [request] = await llmRequests(system);
    expect(request.input.messages[0]?.content[1]).toMatchObject({ mediaRole: "pdf" });
    expect(request.requirements).toMatchObject({ input: { modalities: ["text", "pdf"] } });
  });

  it("rejects unsupported audio artifacts", async () => {
    const artifact = makeArtifact({ artifactId: "artifact-1", mime: "audio/mpeg", filename: "voice.mp3" });
    const { system, extractionRef } = await createSystem({ [artifact.artifactId]: artifact });
    await system.send(extractionRef, {
      type: "structuredExtractionRequest",
      requestId: "req-1",
      replyTo: { actorId: "/capture", actorKind: ActorKind.Capture },
      artifactId: artifact.artifactId,
      schemaId: "invoice",
      scope: scopeFor(artifact),
    } as never);
    await system.runUntilIdle();
    const messages = await captureMessages(system);
    expect(messages[0]).toMatchObject({ result: { type: "error", error: { code: "STRUCTURED_EXTRACTION_ARTIFACT_KIND_UNSUPPORTED" } } });
  });

  it("creates metadata after an LLM JSON result and completes successfully after metadata ok", async () => {
    const artifact = makeArtifact({ artifactId: "artifact-1", mime: "image/png", filename: "invoice.png" });
    const { system, extractionRef } = await createSystem({ [artifact.artifactId]: artifact });
    await system.send(extractionRef, {
      type: "structuredExtractionRequest",
      requestId: "req-1",
      replyTo: { actorId: "/capture", actorKind: ActorKind.Capture },
      artifactId: artifact.artifactId,
      schemaId: "invoice",
      scope: scopeFor(artifact),
    } as never);
    await system.runUntilIdle();
    const [request] = await llmRequests(system);
    const llmResult: LlmResult = { type: "ok", requestId: request.requestId!, output: [{ kind: "json", value: validInvoiceValue() }] };
    await system.send(extractionRef, { type: "llmRequestCompleted", requestId: request.requestId!, result: llmResult } satisfies LlmRequestCompleted as never);
    await system.runUntilIdle();
    const [metadataRequest] = await metadataRequests(system);
    expect(metadataRequest).toMatchObject({ subject: { type: "artifact", ref: { artifactId: artifact.artifactId } }, schemaRef: getCurrentDefaultExtractionSchemaRef("invoice"), value: validInvoiceValue() });

    await system.send(extractionRef, {
      type: "metadataRecordCompleted",
      requestId: metadataRequest.requestId!,
      result: {
        type: "ok",
        record: {
          recordId: "record-1",
          subject: metadataRequest.subject,
          schemaRef: metadataRequest.schemaRef,
          schemaHash: "hash-1",
          value: metadataRequest.value,
          createdBy: "/metadata",
          createdAt: "2026-06-01T00:00:00.000Z",
        },
      },
    } satisfies MetadataRecordCompleted as never);
    await system.runUntilIdle();
    const messages = await captureMessages(system);
    expect(messages.at(-1)).toMatchObject({ result: { type: "ok", metadataRecordId: "record-1", value: validInvoiceValue() } });
  });

  it("prunes schema-unsupported fields before metadata write while keeping valid schema fields", async () => {
    const artifact = makeArtifact({ artifactId: "artifact-1", mime: "application/pdf", filename: "invoice.pdf" });
    const { system, extractionRef } = await createSystem({ [artifact.artifactId]: artifact });
    await system.send(extractionRef, {
      type: "structuredExtractionRequest",
      requestId: "req-prune",
      replyTo: { actorId: "/capture", actorKind: ActorKind.Capture },
      artifactId: artifact.artifactId,
      schemaId: "invoice",
      scope: scopeFor(artifact),
    } as never);
    await system.runUntilIdle();
    const [request] = await llmRequests(system);
    const llmResult: LlmResult = {
      type: "ok",
      requestId: request.requestId!,
      output: [{
        kind: "json",
        value: {
          vendor: { name: "Fly.io, Inc.", extra_vendor_field: "drop-me" },
          buyer: { name: "Visioncreator GmbH" },
          header: { document_kind: "invoice" },
          statements: [{
            line_items: [{ description: "Hosting", quantity: 1, amount: 12.5, tax_rate: 19 }],
          }],
          extra_top_level: true,
        },
      }],
    };
    await system.send(extractionRef, { type: "llmRequestCompleted", requestId: request.requestId!, result: llmResult } satisfies LlmRequestCompleted as never);
    await system.runUntilIdle();
    const [metadataRequest] = await metadataRequests(system);
    expect(metadataRequest.value).toEqual({
      vendor: { name: "Fly.io, Inc." },
      buyer: { name: "Visioncreator GmbH" },
      header: { document_kind: "invoice" },
      statements: [{
        line_items: [{ description: "Hosting", quantity: 1, amount: 12.5 }],
      }],
    });
  });

  it("returns typed LLM and metadata failures", async () => {
    const artifact = makeArtifact({ artifactId: "artifact-1", mime: "image/png", filename: "invoice.png" });
    const { system, extractionRef } = await createSystem({ [artifact.artifactId]: artifact });
    await system.send(extractionRef, {
      type: "structuredExtractionRequest",
      requestId: "req-1",
      replyTo: { actorId: "/capture", actorKind: ActorKind.Capture },
      artifactId: artifact.artifactId,
      schemaId: "invoice",
      scope: scopeFor(artifact),
    } as never);
    await system.runUntilIdle();
    const [request] = await llmRequests(system);
    await system.send(extractionRef, {
      type: "llmRequestCompleted",
      requestId: request.requestId!,
      result: { type: "error", requestId: request.requestId!, error: { category: "providerError", code: "X", message: "boom" } },
    } satisfies LlmRequestCompleted as never);
    await system.runUntilIdle();
    let messages = await captureMessages(system);
    expect(messages.at(-1)).toMatchObject({ result: { type: "error", error: { code: "STRUCTURED_EXTRACTION_LLM_FAILED" } } });

    await system.send(extractionRef, {
      type: "structuredExtractionRequest",
      requestId: "req-2",
      replyTo: { actorId: "/capture", actorKind: ActorKind.Capture },
      artifactId: artifact.artifactId,
      schemaId: "invoice",
      scope: scopeFor(artifact),
    } as never);
    await system.runUntilIdle();
    const requests = await llmRequests(system);
    const secondRequest = requests.at(-1)!;
    await system.send(extractionRef, { type: "llmRequestCompleted", requestId: secondRequest.requestId!, result: { type: "ok", requestId: secondRequest.requestId!, output: [{ kind: "json", value: validInvoiceValue({ header: { document_kind: "invoice", invoice_number: "INV-2" } }) }] } } satisfies LlmRequestCompleted as never);
    await system.runUntilIdle();
    const secondMetadata = (await metadataRequests(system)).at(-1)!;
    await system.send(extractionRef, {
      type: "metadataRecordCompleted",
      requestId: secondMetadata.requestId!,
      result: { type: "error", error: { category: "metadataInvalid", message: "conflict" } },
    } satisfies MetadataRecordCompleted as never);
    await system.runUntilIdle();
    messages = await captureMessages(system);
    expect(messages.at(-1)).toMatchObject({ result: { type: "error", error: { code: "STRUCTURED_EXTRACTION_METADATA_FAILED" } } });
  });

  it("uses unique llm request ids per intent and repair attempt", async () => {
    const artifact = makeArtifact({ artifactId: "artifact-1", mime: "image/png", filename: "invoice.png" });
    const { system, extractionRef } = await createSystem({ [artifact.artifactId]: artifact });

    await system.send(extractionRef, {
      type: "structuredExtractionRequest",
      requestId: "toolrun~2",
      replyTo: { actorId: "/capture", actorKind: ActorKind.Capture },
      artifactId: artifact.artifactId,
      schemaId: "invoice",
      scope: { ...scopeFor(artifact), intentId: "intent~99" },
    } as never);
    await system.runUntilIdle();

    const [firstRequest] = await llmRequests(system);
    expect(firstRequest.requestId).toBe("intent~99~toolrun~2~llm");

    await system.send(extractionRef, {
      type: "llmRequestCompleted",
      requestId: firstRequest.requestId!,
      result: {
        type: "error",
        requestId: firstRequest.requestId!,
        error: {
          category: "schemaInvalid",
          code: "SCHEMA_VALUE_VALIDATION_FAILED",
          message: "bad shape",
          details: [{ instancePath: "/x", message: "bad" }],
        },
      },
    } satisfies LlmRequestCompleted as never);
    await system.runUntilIdle();

    const requests = await llmRequests(system);
    const repairRequest = requests.at(-1)!;
    expect(repairRequest.requestId).toBe("intent~99~toolrun~2~llm~repair1");
  });

  it("retries once on schema-invalid llm output and then reports failure if repair also fails", async () => {
    const artifact = makeArtifact({ artifactId: "artifact-1", mime: "image/png", filename: "invoice.png" });
    const { system, extractionRef } = await createSystem({ [artifact.artifactId]: artifact });

    await system.send(extractionRef, {
      type: "structuredExtractionRequest",
      requestId: "req-repair",
      replyTo: { actorId: "/capture", actorKind: ActorKind.Capture },
      artifactId: artifact.artifactId,
      schemaId: "invoice",
      scope: scopeFor(artifact),
    } as never);
    await system.runUntilIdle();

    const [initialRequest] = await llmRequests(system);
    await system.send(extractionRef, {
      type: "llmRequestCompleted",
      requestId: initialRequest.requestId!,
      result: {
        type: "error",
        requestId: initialRequest.requestId!,
        error: {
          category: "schemaInvalid",
          code: "SCHEMA_VALUE_VALIDATION_FAILED",
          message: "first failed",
          details: {
            candidateValue: {
              vendor: { name: "Vendor Co" },
              buyer: { name: "Buyer Co" },
              header: { document_kind: "invoice" },
              statements: [{
                line_items: [{ description: "Consulting", unit_name: "hours" }],
              }],
            },
            validationDetails: [{ instancePath: "/line_items", message: "wrong shape" }],
          },
        },
      },
    } satisfies LlmRequestCompleted as never);
    await system.runUntilIdle();

    const requestsAfterRepair = await llmRequests(system);
    expect(requestsAfterRepair).toHaveLength(2);
    const repairRequest = requestsAfterRepair[1]!;
    const repairPromptPart = repairRequest.input.messages[0]?.content[0];
    const repairPromptText = repairPromptPart && "text" in repairPromptPart ? repairPromptPart.text : "";
    expect(repairPromptText).toContain("Previous output failed schema validation.");
    expect(repairPromptText).toContain("Here is the previous candidate JSON that was closest to the target schema.");
    expect(repairPromptText).toContain('"unit_name": "hours"');
    expect(repairPromptText).toContain("Validation errors from the previous attempt:");
    expect(repairPromptText).toContain("When validation reports additionalProperties errors, delete those properties entirely");
    expect(repairPromptText).toContain("When validation reports required-property errors, repair the object");

    await system.send(extractionRef, {
      type: "llmRequestCompleted",
      requestId: repairRequest.requestId!,
      result: {
        type: "error",
        requestId: repairRequest.requestId!,
        error: {
          category: "schemaInvalid",
          code: "SCHEMA_VALUE_VALIDATION_FAILED",
          message: "repair failed too",
          details: {
            candidateValue: {
              vendor: { name: "Vendor Co" },
              buyer: { name: "Buyer Co" },
              header: { document_kind: "invoice" },
              statements: [{
                line_items: [{ description: "Consulting", unit_name: "hours" }],
              }],
            },
            validationDetails: [{ instancePath: "/x", message: "bad" }],
          },
        },
      },
    } satisfies LlmRequestCompleted as never);
    await system.runUntilIdle();

    const messages = await captureMessages(system);
    expect(messages.at(-1)).toMatchObject({
      result: {
        type: "error",
        error: {
          code: "STRUCTURED_EXTRACTION_LLM_FAILED",
          message: "repair failed too",
        },
      },
    });
  });
});