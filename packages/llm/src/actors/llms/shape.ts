import { buildActorRuntime, defineActorShape, field, msg, op, type DerivedActorRuntime, type DerivedDebugMessageDescriptor, type JsonValue } from "typed-actors";
import type { DebugMessageDescriptor } from "../../../../runtime/src/spine.ts";
import type {
  LlmsMessage,
  LlmsState,
  LlmRequestWorkerMessage,
  LlmRequestWorkerState,
  LlmRequestRetentionPolicy,
  LlmModelMessage,
  LlmProviderMessage,
  LlmModelState,
  LlmProviderState,
} from "./types.ts";
import type { LlmCapabilityRequirements, LlmModelCapabilities } from "llm-contracts";
import {
  rootSummary,
  buildModelExecutionSummary,
  modelSummary,
  providerStateSummary,
  requestAliasSummary,
} from "../../results.ts";

const artifactPartSchema = {
  type: "object",
  required: ["kind", "ref"],
  additionalProperties: false,
  properties: {
    kind: { const: "artifact" },
    ref: {
      type: "object",
      required: ["artifactId", "blob"],
      additionalProperties: false,
      properties: {
        artifactId: { type: "string" },
        blob: {
          type: "object",
          required: ["algorithm", "hash", "sizeBytes"],
          additionalProperties: false,
          properties: {
            algorithm: { const: "sha256" },
            hash: { type: "string" },
            sizeBytes: { type: "integer", minimum: 0 },
          },
        },
      },
    },
    mediaRole: { type: "string" },
  },
} as const;

const llmMessageSchema = {
  type: "object",
  required: ["role", "content"],
  additionalProperties: false,
  properties: {
    role: { enum: ["system", "user", "assistant"] },
    content: {
      type: "array",
      minItems: 1,
      items: {
        oneOf: [
          { type: "object", required: ["kind", "text"], additionalProperties: false, properties: { kind: { const: "text" }, text: { type: "string" } } },
          { type: "object", required: ["kind", "value"], additionalProperties: false, properties: { kind: { const: "json" }, value: {} } },
          artifactPartSchema,
        ],
      },
    },
  },
} as const;

const schemaRefSchema = {
  type: "object",
  required: ["schemaId", "version"],
  additionalProperties: false,
  properties: {
    schemaId: { type: "string" },
    version: { type: "string" },
  },
} as const;

const llmRequestInputSchema = {
  type: "object",
  required: ["messages"],
  additionalProperties: false,
  properties: {
    messages: {
      type: "array",
      minItems: 1,
      items: llmMessageSchema,
    },
  },
} as const;

const llmCapabilityRequirementsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    input: {
      type: "object",
      additionalProperties: false,
      properties: {
        modalities: { type: "array", items: { type: "string" } },
      },
    },
    output: {
      type: "object",
      additionalProperties: false,
      properties: {
        modalities: { type: "array", items: { type: "string" } },
      },
    },
    general: {
      type: "object",
      additionalProperties: false,
      properties: {
        requires: { type: "array", items: { type: "string" } },
      },
    },
  },
} as const;

/** Minimal root llm shape used to unlock actor-definition adoption. */
export const llmsShape = defineActorShape({
  kind: "llms",
  state: {
    ready: field.boolean({ default: true }),
    catalog: field.ref<LlmsState["catalog"]>({ default: [] as LlmsState["catalog"] }),
    usageByCallerActorId: field.ref<LlmsState["usageByCallerActorId"]>({ default: {} as LlmsState["usageByCallerActorId"] }),
    pendingRequests: field.ref<LlmsState["pendingRequests"]>({ default: {} as LlmsState["pendingRequests"] }),
  },
  messages: {
    submitLlmRequest: msg({
      requestId: field.string({ optional: true }),
      replyTo: field.json({ optional: true }),
      input: field.schema(llmRequestInputSchema),
      responseSchema: field.schema(schemaRefSchema, { optional: true }),
      maxOutputTokens: field.integer({ optional: true }),
      thinking: field.ref<"default" | "enabled" | "disabled">({ optional: true }),
      requirements: field.ref<LlmCapabilityRequirements>({ optional: true }),
      preferredModelActorPath: field.string({ optional: true }),
      selectionPolicy: field.string({ optional: true }),
      callerActorId: field.string({ optional: true }),
    }),
    listAvailableLlms: msg({
      requirements: field.ref<LlmCapabilityRequirements>({ optional: true }),
    }),
    findLlmsByCapabilities: msg({
      requirements: field.ref<LlmCapabilityRequirements>(),
    }),
    getLlmUsage: msg({
      callerActorId: field.string({ optional: true }),
    }),
    llmRequestCompleted: msg({
      requestId: field.string(),
      result: field.json(),
    }),
    registerAvailableLlm: msg({
      descriptor: field.json(),
    }),
    replaceProviderCatalog: msg({
      providerId: field.string(),
      descriptors: field.json(),
    }),
  },
  operations: {
    submitLlmRequest: op({
      title: "Submit request via gateway",
      description: "Submit an LLM request through the public llms gateway.",
      mutates: true,
      input: {
        input: field.schema(llmRequestInputSchema, {
          default: {
            messages: [{ role: "user", content: [{ kind: "text", text: "Say hello in one short sentence." }] }],
          },
        }),
        requirements: field.ref<LlmCapabilityRequirements>({ optional: true }),
        responseSchema: field.schema(schemaRefSchema, { optional: true }),
        maxOutputTokens: field.integer({ optional: true, default: 1024 }),
        thinking: field.enum("default", "enabled", "disabled"),
      },
      defaultValue: {
        input: { messages: [{ role: "user", content: [{ kind: "text", text: "Say hello in one short sentence." }] }] },
        requirements: { input: { modalities: ["text"] }, output: { modalities: ["text"] } },
        thinking: "default",
        maxOutputTokens: 1024,
      },
    }),
    listAvailableLlms: op({
      title: "List available LLMs",
      input: {
        requirements: field.ref<LlmCapabilityRequirements>({ optional: true }),
      },
    }),
    findLlmsByCapabilities: op({
      title: "Find LLMs by capabilities",
      input: {
        requirements: field.ref<LlmCapabilityRequirements>({
          default: { input: { modalities: ["text"] }, output: { modalities: ["text"] } },
        }),
      },
    }),
    getLlmUsage: op({
      title: "Get LLM usage",
      input: {
        callerActorId: field.string({ optional: true }),
      },
    }),
  },
  present() {
    return {
      title: "llms",
      subtitle: "gateway + catalog",
    };
  },
});

/** Minimal provider shape used with custom init and custom isMessage. */
export const llmProviderShape = defineActorShape({
  kind: "llmProvider",
  state: {
    providerId: field.string(),
    title: field.string(),
    protocol: field.string(),
    baseUrl: field.string(),
    auth: field.ref<LlmProviderState["auth"]>(),
    modelDefaults: field.ref<{ readonly capabilities: LlmModelCapabilities }>(),
    modelIds: field.ref<readonly string[]>({ default: [] as readonly string[] }),
    modelSlugsById: field.ref<Readonly<Record<string, string>>>({ default: {} as Readonly<Record<string, string>> }),
    modelsById: field.ref<LlmProviderState["modelsById"]>({ default: {} as LlmProviderState["modelsById"] }),
    defaults: field.ref<LlmProviderState["defaults"]>(),
  },
  messages: {
    listModels: msg({}),
  },
  operations: {
    listModels: op({
      title: "List models",
      description: "List configured provider models.",
    }),
  },
  present(state) {
    return {
      title: state.title,
      subtitle: `${state.modelIds.length} models`,
    };
  },
});

/** Minimal model shape used with custom init. */
export const llmModelShape = defineActorShape({
  kind: "llmModel",
  state: {
    providerId: field.string(),
    providerTitle: field.string(),
    providerProtocol: field.string(),
    providerBaseUrl: field.string(),
    modelId: field.string(),
    configId: field.string(),
    title: field.string(),
    slug: field.string(),
    capabilities: field.ref<LlmModelState["capabilities"]>(),
    pricing: field.ref<LlmModelState["pricing"]>({ optional: true }),
    maxParallel: field.integer(),
    maxQueue: field.integer(),
    defaultMaxOutputTokens: field.integer({ optional: true }),
    retention: field.ref<LlmModelState["retention"]>(),
    nextRequestNumber: field.integer({ default: 1 }),
    queued: field.ref<LlmModelState["queued"]>({ default: [] as LlmModelState["queued"] }),
    running: field.ref<LlmModelState["running"]>({ default: {} as LlmModelState["running"] }),
    completedRecent: field.ref<LlmModelState["completedRecent"]>({ default: {} as LlmModelState["completedRecent"] }),
    completedOrder: field.ref<LlmModelState["completedOrder"]>({ default: [] as LlmModelState["completedOrder"] }),
    evictedCompletedCount: field.integer({ default: 0 }),
    available: field.boolean(),
    lastSeenAt: field.string({ optional: true }),
  },
  messages: {
    submitLlmRequest: msg({
      requestId: field.string({ optional: true }),
      replyTo: field.json({ optional: true }),
      input: field.schema(llmRequestInputSchema),
      responseSchema: field.schema(schemaRefSchema, { optional: true }),
      maxOutputTokens: field.integer({ optional: true }),
      thinking: field.ref<"default" | "enabled" | "disabled">({ optional: true }),
    }),
    listRequests: msg({}),
    describeCapabilities: msg({}),
    validateLlmInput: msg({
      input: field.schema(llmRequestInputSchema),
      thinking: field.enum("default", "enabled", "disabled"),
      responseSchema: field.schema(schemaRefSchema, { optional: true }),
      maxOutputTokens: field.integer({ optional: true }),
    }),
    requestCompleted: msg({
      requestId: field.string(),
      result: field.json(),
    }),
    refreshModelConfig: msg({
      providerTitle: field.string(),
      providerProtocol: field.string(),
      providerBaseUrl: field.string(),
      configId: field.string(),
      title: field.string(),
      capabilities: field.json(),
      pricing: field.json({ optional: true }),
      maxParallel: field.integer(),
      maxQueue: field.integer(),
      defaultMaxOutputTokens: field.integer({ optional: true }),
      available: field.boolean(),
      lastSeenAt: field.string(),
    }),
  },
  operations: {
    submitLlmRequest: op({
      title: "Submit request",
      description: "Submit a real OpenAI-compatible chat completion request.",
      mutates: true,
      input: {
        requestId: field.string({ optional: true }),
        replyTo: field.json({ optional: true }),
        input: field.schema(llmRequestInputSchema, {
          default: {
            messages: [{ role: "user", content: [{ kind: "text", text: "Say hello in one short sentence." }] }],
          },
        }),
        responseSchema: field.schema(schemaRefSchema, { optional: true }),
        maxOutputTokens: field.integer({ optional: true, default: 1024 }),
        thinking: field.enum("default", "enabled", "disabled"),
      },
      defaultValue: {
        input: { messages: [{ role: "user", content: [{ kind: "text", text: "Say hello in one short sentence." }] }] },
        thinking: "default",
        maxOutputTokens: 1024,
      },
    }),
    listRequests: op({
      title: "List requests",
      description: "List queued, running, and completed request ids.",
    }),
    describeCapabilities: op({
      title: "Describe capabilities",
      description: "Return configured model capabilities.",
    }),
    validateLlmInput: op({
      title: "Validate input",
      description: "Validate input parts and thinking options against model capabilities.",
      input: {
        input: field.schema(llmRequestInputSchema, {
          default: {
            messages: [{ role: "user", content: [
              {
                kind: "artifact",
                ref: {
                  artifactId: "artifact-1",
                  blob: { algorithm: "sha256", hash: "<paste-blob-hash>", sizeBytes: 123 },
                },
                mediaRole: "image",
              },
            ] }],
          },
        }),
        thinking: field.enum("default", "enabled", "disabled"),
        responseSchema: field.schema(schemaRefSchema, { optional: true }),
        maxOutputTokens: field.integer({ optional: true }),
      },
      defaultValue: {
        input: {
          messages: [{
            role: "user",
            content: [{
              kind: "artifact",
              ref: {
                artifactId: "artifact-1",
                blob: { algorithm: "sha256", hash: "<paste-blob-hash>", sizeBytes: 123 },
              },
              mediaRole: "image",
            }],
          }],
        },
        thinking: "default",
      },
    }),
  },
  present(state) {
    return {
      title: state.modelId,
      subtitle: state.available ? state.configId : "unavailable",
    };
  },
});

/** Minimal request worker shape used with custom init and custom isMessage. */
export const llmRequestWorkerShape = defineActorShape({
  kind: "llmRequestWorker",
  state: {
    providerId: field.string(),
    providerTitle: field.string(),
    providerBaseUrl: field.string(),
    modelId: field.string(),
    configId: field.string(),
    capabilities: field.ref<LlmRequestWorkerState["capabilities"]>(),
    requestId: field.string(),
    status: field.string(),
    request: field.ref<LlmRequestWorkerState["request"]>(),
    pendingStructuredOutput: field.json({ optional: true }),
    awaiting: field.string({ optional: true }),
    result: field.ref<LlmRequestWorkerState["result"]>({ optional: true }),
  },
  messages: {
    beginProcessing: msg({}),
    getResult: msg({}),
    schemaValidationCompleted: msg({
      requestId: field.string(),
      result: field.json(),
    }),
  },
  operations: {
    getResult: op({
      title: "Get result",
      description: "Return the current result for this request actor.",
    }),
  },
  present(state) {
    return {
      title: state.requestId,
      subtitle: state.status,
      tags: ["llm-request", state.providerId],
    };
  },
});

export const llmProviderRuntime = buildActorRuntime(llmProviderShape) as DerivedActorRuntime<
  typeof llmProviderShape.messages,
  LlmProviderState
> & {
  readonly isMessage: (value: unknown) => value is LlmProviderMessage;
};

export const llmsRuntime = buildActorRuntime(llmsShape) as DerivedActorRuntime<
  typeof llmsShape.messages,
  LlmsState
> & {
  readonly isMessage: (value: unknown) => value is LlmsMessage;
};

export const llmModelRuntime = buildActorRuntime(llmModelShape) as DerivedActorRuntime<
  typeof llmModelShape.messages,
  LlmModelState
> & {
  readonly isMessage: (value: unknown) => value is LlmModelMessage;
};

export const llmRequestWorkerRuntime = buildActorRuntime(llmRequestWorkerShape) as DerivedActorRuntime<
  typeof llmRequestWorkerShape.messages,
  LlmRequestWorkerState
> & {
  readonly isMessage: (value: unknown) => value is LlmRequestWorkerMessage;
};

function requireDebugDescriptor(descriptors: readonly DerivedDebugMessageDescriptor[], id: string): DebugMessageDescriptor {
  const descriptor = descriptors.find((entry) => entry.id === id);
  if (!descriptor) {
    throw new Error(`Missing LLM debug descriptor '${id}'.`);
  }
  return descriptor as DebugMessageDescriptor;
}

export const submitLlmRequestDescriptor = requireDebugDescriptor(llmModelRuntime.debugDescriptors, "llmModel.submitLlmRequest");
export const listRequestsDescriptor = requireDebugDescriptor(llmModelRuntime.debugDescriptors, "llmModel.listRequests");
export const getResultDescriptor = requireDebugDescriptor(llmRequestWorkerRuntime.debugDescriptors, "llmRequestWorker.getResult");
export const describeCapabilitiesDescriptor = requireDebugDescriptor(llmModelRuntime.debugDescriptors, "llmModel.describeCapabilities");
export const validateLlmInputDescriptor = requireDebugDescriptor(llmModelRuntime.debugDescriptors, "llmModel.validateLlmInput");
export const listModelsDescriptor = requireDebugDescriptor(llmProviderRuntime.debugDescriptors, "llmProvider.listModels");

export const listAvailableLlmsDescriptor = requireDebugDescriptor(llmsRuntime.debugDescriptors, "llms.listAvailableLlms");
export const findLlmsByCapabilitiesDescriptor = requireDebugDescriptor(llmsRuntime.debugDescriptors, "llms.findLlmsByCapabilities");
export const getLlmUsageDescriptor = requireDebugDescriptor(llmsRuntime.debugDescriptors, "llms.getLlmUsage");

export const llmDebugMessageDescriptors: readonly DebugMessageDescriptor[] = [
  listAvailableLlmsDescriptor,
  findLlmsByCapabilitiesDescriptor,
  getLlmUsageDescriptor,
  submitLlmRequestDescriptor,
  listRequestsDescriptor,
  getResultDescriptor,
  describeCapabilitiesDescriptor,
  validateLlmInputDescriptor,
  listModelsDescriptor,
];