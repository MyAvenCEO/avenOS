import type { LlmArtifactKind } from "llm-contracts";
import type { OpenAiChatContentPart, LlmChatCompletionInput, LlmHttpClient } from "../../client.ts";
import { clone } from "../../support.ts";
import { dataUrl, normalizeOpenAiStructuredOutputSchema, resolveArtifactsForRequest, validateResolvedArtifacts } from "../shared.ts";
import type { AdapterExecutionOutput, LlmProviderAdapter } from "../types.ts";

const SUPPORTED_KINDS: readonly LlmArtifactKind[] = ["image", "audio"];

function audioFormat(mime: string): "wav" | "mp3" | undefined {
  switch (mime) {
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    case "audio/mpeg":
      return "mp3";
    default:
      return undefined;
  }
}

export function createOpenAiChatCompletionsAdapter(): LlmProviderAdapter<LlmChatCompletionInput> {
  return {
    protocol: "openai.chat-completions",
    resolveArtifacts: resolveArtifactsForRequest,
    validate({ request, capabilities }) {
      const validation = validateResolvedArtifacts({
        request,
        capabilities,
        supportedKinds: SUPPORTED_KINDS,
        requiredTransportByKind: {
          image: "openai.chat.image_url.data_url",
          audio: "openai.chat.input_audio.base64",
        },
      });
      if (validation) return validation;
      for (const artifact of request.artifacts) {
        if (artifact.kind === "audio" && !audioFormat(artifact.effectiveMimeType)) {
          return {
            category: "modelCapability",
            code: "LLM_AUDIO_MIME_UNSUPPORTED",
            message: `Unsupported audio MIME type '${artifact.effectiveMimeType}' for OpenAI Chat Completions input_audio.`,
          };
        }
      }
      return undefined;
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
            if (resolved.kind === "image") {
              return { type: "image_url", image_url: { url: dataUrl(resolved.effectiveMimeType, resolved.bytes) } };
            }
            return {
              type: "input_audio",
              input_audio: {
                data: Buffer.from(resolved.bytes).toString("base64"),
                format: audioFormat(resolved.effectiveMimeType)!,
              },
            };
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