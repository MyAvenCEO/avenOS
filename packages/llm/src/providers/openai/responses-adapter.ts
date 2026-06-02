import type { LlmArtifactKind, LlmModelCapabilities } from "llm-contracts";
import type { JsonValue } from "typed-actors";
import type { LlmHttpClient, OpenAiResponsesContentPart, OpenAiResponsesInput } from "../../client.ts";
import { clone } from "../../support.ts";
import { dataUrl, normalizeOpenAiStructuredOutputSchema, resolveArtifactsForRequest, validateResolvedArtifacts } from "../shared.ts";
import type { AdapterExecutionOutput, LlmProviderAdapter } from "../types.ts";

const SUPPORTED_KINDS: readonly LlmArtifactKind[] = ["image", "pdf", "text", "code", "document", "presentation", "spreadsheet"];

function filePart(filename: string | undefined, mime: string, bytes: Uint8Array): OpenAiResponsesContentPart {
  return {
    type: "input_file",
    filename: filename ?? "artifact",
    file_data: dataUrl(mime, bytes),
  };
}

function compileParts(input: {
  readonly request: Awaited<ReturnType<typeof resolveArtifactsForRequest>> extends infer T ? Exclude<T, { category: string }> : never;
  readonly forceJsonOnlyTextInstruction: boolean;
}): OpenAiResponsesInput["input"] {
  const artifactById = new Map(input.request.artifacts.map((artifact) => [artifact.inputPart.ref.artifactId, artifact]));
  const messages = input.request.request.input.messages.map((message) => ({
    role: message.role,
    content: message.content.map((part): OpenAiResponsesContentPart => {
      if (part.kind === "text") {
        return { type: "input_text", text: part.text };
      }
      if (part.kind === "json") {
        return { type: "input_text", text: JSON.stringify(part.value) };
      }
      const resolved = artifactById.get(part.ref.artifactId);
      if (!resolved) {
        throw new Error(`Missing resolved artifact '${part.ref.artifactId}'.`);
      }
      if (resolved.kind === "image") {
        return { type: "input_image", image_url: dataUrl(resolved.effectiveMimeType, resolved.bytes) };
      }
      return filePart(resolved.artifact.filename, resolved.effectiveMimeType, resolved.bytes);
    }),
  }));
  if (!input.forceJsonOnlyTextInstruction) {
    return messages;
  }
  return [
    {
      role: "system",
      content: [{
        type: "input_text",
        text: "Return only one JSON object matching the requested schema. Do not include markdown fences, explanations, or any text outside the JSON object.",
      }],
    },
    ...messages,
  ];
}

export function createOpenAiResponsesAdapter(): LlmProviderAdapter<OpenAiResponsesInput> {
  return {
    protocol: "openai.responses",
    resolveArtifacts: resolveArtifactsForRequest,
    validate({ request, capabilities }) {
      return validateResolvedArtifacts({
        request,
        capabilities,
        supportedKinds: SUPPORTED_KINDS,
        requiredTransportByKind: {
          image: "openai.responses.input_image.data_url",
          pdf: "openai.responses.input_file.data_url",
          text: "openai.responses.input_file.data_url",
          code: "openai.responses.input_file.data_url",
          document: "openai.responses.input_file.data_url",
          presentation: "openai.responses.input_file.data_url",
          spreadsheet: "openai.responses.input_file.data_url",
        },
      });
    },
    async compile({ request, modelId, structuredOutputSchema }) {
      const normalizedStructuredSchema = structuredOutputSchema === undefined
        ? undefined
        : normalizeOpenAiStructuredOutputSchema(structuredOutputSchema, { schemaId: request.request.responseSchema?.schemaId });
      return {
        model: modelId,
        input: compileParts({
          request: request as never,
          forceJsonOnlyTextInstruction: structuredOutputSchema !== undefined && normalizedStructuredSchema === undefined,
        }),
        ...(request.request.maxOutputTokens === undefined ? {} : { maxOutputTokens: request.request.maxOutputTokens }),
        ...(normalizedStructuredSchema === undefined
          ? { text: { format: { type: "text" as const } } }
          : {
              text: {
                format: {
                  type: "json_schema" as const,
                  name: request.request.responseSchema?.schemaId.replace(/[^A-Za-z0-9_-]/gu, "_") ?? "result",
                  strict: true,
                  schema: normalizedStructuredSchema,
                },
              },
            }),
      };
    },
    async execute({ client, request }): Promise<AdapterExecutionOutput> {
      if (!client.responses) {
        throw new Error("Configured provider does not implement the OpenAI Responses API.");
      }
      return client.responses(request);
    },
  };
}