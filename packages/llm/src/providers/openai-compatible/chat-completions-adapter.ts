import type { LlmArtifactKind } from "llm-contracts";
import type { OpenAiChatContentPart, LlmChatCompletionInput } from "../../client.ts";
import { clone } from "../../support.ts";
import { dataUrl, normalizeOpenAiStructuredOutputSchema, resolveArtifactsForRequest, validateResolvedArtifacts } from "../shared.ts";
import type { AdapterExecutionOutput, LlmProviderAdapter } from "../types.ts";

const SUPPORTED_KINDS: readonly LlmArtifactKind[] = ["image"];

export function createOpenAiCompatibleChatCompletionsAdapter(): LlmProviderAdapter<LlmChatCompletionInput> {
  return {
    protocol: "openai-compatible.chat-completions",
    resolveArtifacts: resolveArtifactsForRequest,
    validate({ request, capabilities }) {
      return validateResolvedArtifacts({
        request,
        capabilities,
        supportedKinds: SUPPORTED_KINDS,
        requiredTransportByKind: { image: "openai.chat.image_url.data_url" },
      });
    },
    async compile({ request, modelId, structuredOutputSchema }) {
      const artifactById = new Map(request.artifacts.map((artifact) => [artifact.inputPart.ref.artifactId, artifact]));
      const normalizedStructuredSchema = structuredOutputSchema === undefined
        ? undefined
        : normalizeOpenAiStructuredOutputSchema(structuredOutputSchema, { schemaId: request.request.responseSchema?.schemaId });
      const compiledMessages = request.request.input.messages.map((message) => ({
          role: message.role,
          content: message.content.map((part): OpenAiChatContentPart => {
            if (part.kind === "text") return { type: "text", text: part.text };
            if (part.kind === "json") return { type: "text", text: JSON.stringify(part.value) };
            const resolved = artifactById.get(part.ref.artifactId);
            if (!resolved) throw new Error(`Missing resolved artifact '${part.ref.artifactId}'.`);
            return { type: "image_url", image_url: { url: dataUrl(resolved.effectiveMimeType, resolved.bytes) } };
          }),
        }));
      const messages = structuredOutputSchema !== undefined && normalizedStructuredSchema === undefined
        ? [{
            role: "system" as const,
            content: "Return only one JSON object matching the requested schema. Do not include markdown fences, explanations, or any text outside the JSON object.",
          }, ...compiledMessages]
        : compiledMessages;
      return {
        model: modelId,
        messages,
        temperature: 0.2,
        stream: false,
        ...(request.request.maxOutputTokens === undefined ? {} : { maxTokens: request.request.maxOutputTokens }),
        ...(normalizedStructuredSchema === undefined
          ? {}
          : {
              responseFormat: {
                type: "json_schema" as const,
                json_schema: {
                  name: request.request.responseSchema?.schemaId.replace(/[^A-Za-z0-9_-]/gu, "_") ?? "result",
                  strict: true,
                  schema: normalizedStructuredSchema,
                },
              },
            }),
      };
    },
    async execute({ client, request }): Promise<AdapterExecutionOutput> {
      return client.chatCompletion(request);
    },
  };
}