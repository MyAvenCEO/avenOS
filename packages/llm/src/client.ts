import type { JsonValue } from "typed-actors";
import { isJsonObject } from "../../shared/src/index.ts";

export interface LlmModelInfo {
  readonly id: string;
  readonly object?: string;
  readonly ownedBy?: string;
}

export interface LlmChatCompletionMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string | readonly OpenAiChatContentPart[];
}

export type OpenAiChatContentPart =
  | OpenAiChatTextContentPart
  | OpenAiChatImageUrlContentPart
  | OpenAiChatInputAudioContentPart;

export interface OpenAiChatTextContentPart {
  readonly type: "text";
  readonly text: string;
}

export interface OpenAiChatImageUrlContentPart {
  readonly type: "image_url";
  readonly image_url: {
    readonly url: string;
  };
}

export interface OpenAiChatInputAudioContentPart {
  readonly type: "input_audio";
  readonly input_audio: {
    readonly data: string;
    readonly format: "wav" | "mp3";
  };
}

export interface LlmChatCompletionInput {
  readonly model: string;
  readonly messages: readonly LlmChatCompletionMessage[];
  readonly temperature: number;
  readonly stream: false;
  readonly maxTokens?: number;
  readonly responseFormat?:
    | { readonly type: "text" }
    | {
        readonly type: "json_schema";
        readonly json_schema: {
          readonly name: string;
          readonly strict?: boolean;
          readonly schema: JsonValue;
        };
      };
}

export interface LlmChatCompletionResult {
  readonly content: string;
  readonly model?: string;
  readonly usage?: JsonValue;
  readonly rawId?: string;
  readonly finishReason?: string;
}

export interface OpenAiResponsesInput {
  readonly model: string;
  readonly input: readonly {
    readonly role: "system" | "user" | "assistant";
    readonly content: readonly OpenAiResponsesContentPart[];
  }[];
  readonly maxOutputTokens?: number;
  readonly text?:
    | { readonly format: { readonly type: "text" } }
    | {
        readonly format: {
          readonly type: "json_schema";
          readonly name: string;
          readonly strict?: boolean;
          readonly schema: JsonValue;
        };
      };
}

export interface OpenAiResponsesResult {
  readonly content: string;
  readonly model?: string;
  readonly usage?: JsonValue;
  readonly rawId?: string;
  readonly finishReason?: string;
}

export type OpenAiResponsesContentPart =
  | { readonly type: "input_text"; readonly text: string }
  | { readonly type: "input_image"; readonly image_url: string }
  | { readonly type: "input_file"; readonly filename: string; readonly file_data: string };

export interface LlmModelsResponse {
  readonly object?: string;
  readonly data?: Array<{ id: string; object?: string; owned_by?: string }>;
}

export interface LlmHttpClient {
  listModels(): Promise<LlmModelInfo[]>;
  chatCompletion(input: LlmChatCompletionInput): Promise<LlmChatCompletionResult>;
  responses?(input: OpenAiResponsesInput): Promise<OpenAiResponsesResult>;
}

export class LlmHttpClientError extends Error {
  readonly code: "TIMEOUT" | "NETWORK_ERROR" | "HTTP_ERROR" | "INVALID_RESPONSE";
  readonly details?: JsonValue;

  constructor(code: LlmHttpClientError["code"], message: string, details?: JsonValue) {
    super(message);
    this.name = "LlmHttpClientError";
    this.code = code;
    this.details = details;
  }
}

export interface CreateLlmHttpClientOptions {
  readonly baseUrl: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly authHeader?: string;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

function toTextContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  const textParts = content
    .map((part) => {
      if (!isJsonObject(part)) return undefined;
      return typeof part.text === "string" ? part.text : undefined;
    })
    .filter((part): part is string => typeof part === "string");
  return textParts.length > 0 ? textParts.join("\n") : undefined;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new LlmHttpClientError(
      "INVALID_RESPONSE",
      "LLM provider returned invalid JSON.",
      { cause: error instanceof Error ? error.message : String(error) } as JsonValue,
    );
  }
}

async function readErrorBody(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    return text.length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}

export function createLlmHttpClient(options: CreateLlmHttpClientOptions): LlmHttpClient {
  const baseUrl = trimTrailingSlash(options.baseUrl);
  const timeoutMs = options.timeoutMs ?? 10_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const authHeader = options.authHeader;

  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...(authHeader === undefined ? {} : { authorization: authHeader }),
          ...(init?.headers ?? {}),
        },
      });
      if (!response.ok) {
        throw new LlmHttpClientError(
          "HTTP_ERROR",
          `LLM provider request failed with status ${response.status}.`,
          {
            status: response.status,
            statusText: response.statusText,
            body: (await readErrorBody(response)) ?? null,
            path,
          } as JsonValue,
        );
      }
      return await parseJsonResponse(response);
    } catch (error) {
      if (error instanceof LlmHttpClientError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new LlmHttpClientError("TIMEOUT", `LLM provider request timed out after ${timeoutMs}ms.`, {
          timeoutMs,
          path,
        } as JsonValue);
      }
      throw new LlmHttpClientError(
        "NETWORK_ERROR",
        "Failed to reach configured LLM provider.",
        { cause: error instanceof Error ? error.message : String(error), path } as JsonValue,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async listModels(): Promise<LlmModelInfo[]> {
      const payload = await request("/models");
      if (!isJsonObject(payload)) {
        throw new LlmHttpClientError("INVALID_RESPONSE", "LLM provider models response was not an object.");
      }
      const response = payload as LlmModelsResponse;
      if (!Array.isArray(response.data)) {
        throw new LlmHttpClientError("INVALID_RESPONSE", "LLM provider models response did not contain a data array.");
      }
      return response.data
        .filter((entry): entry is { id: string; object?: string; owned_by?: string } => isJsonObject(entry) && typeof entry.id === "string")
        .map((entry) => ({ id: entry.id, object: entry.object, ownedBy: entry.owned_by }));
    },

    async chatCompletion(input: LlmChatCompletionInput): Promise<LlmChatCompletionResult> {
      const payload = await request("/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model: input.model,
          messages: input.messages,
          temperature: input.temperature,
          stream: false,
          ...(input.maxTokens === undefined ? {} : { max_tokens: input.maxTokens }),
          ...(input.responseFormat === undefined ? {} : { response_format: input.responseFormat }),
        }),
      });
      if (!isJsonObject(payload)) {
        throw new LlmHttpClientError("INVALID_RESPONSE", "LLM provider chat completion response was not an object.");
      }
      const rawChoices = payload.choices;
      if (!Array.isArray(rawChoices) || rawChoices.length === 0 || !isJsonObject(rawChoices[0])) {
        throw new LlmHttpClientError("INVALID_RESPONSE", "LLM provider chat completion response did not contain choices.");
      }
      const firstChoice = rawChoices[0] as Record<string, unknown>;
      const message = isJsonObject(firstChoice.message) ? firstChoice.message : undefined;
      const content = toTextContent(message?.content);
      if (content === undefined) {
        throw new LlmHttpClientError("INVALID_RESPONSE", "LLM provider chat completion did not contain text content.");
      }
      return {
        content,
        model: typeof payload.model === "string" ? payload.model : undefined,
        rawId: typeof payload.id === "string" ? payload.id : undefined,
        usage: isJsonObject(payload.usage) ? (payload.usage as JsonValue) : undefined,
        finishReason: typeof firstChoice.finish_reason === "string" ? firstChoice.finish_reason : undefined,
      };
    },

    async responses(input: OpenAiResponsesInput): Promise<OpenAiResponsesResult> {
      const payload = await request("/responses", {
        method: "POST",
        body: JSON.stringify({
          model: input.model,
          input: input.input,
          ...(input.maxOutputTokens === undefined ? {} : { max_output_tokens: input.maxOutputTokens }),
          ...(input.text === undefined ? {} : { text: input.text }),
        }),
      });
      if (!isJsonObject(payload)) {
        throw new LlmHttpClientError("INVALID_RESPONSE", "OpenAI responses API response was not an object.");
      }
      const output = Array.isArray(payload.output) ? payload.output : [];
      const textParts: string[] = [];
      for (const item of output) {
        if (!isJsonObject(item)) continue;
        const content = Array.isArray(item.content) ? item.content : [];
        for (const part of content) {
          if (!isJsonObject(part)) continue;
          if (typeof part.text === "string") textParts.push(part.text);
        }
      }
      const content = textParts.join("\n").trim();
      if (content.length === 0) {
        throw new LlmHttpClientError("INVALID_RESPONSE", "OpenAI responses API did not contain text content.");
      }
      return {
        content,
        model: typeof payload.model === "string" ? payload.model : undefined,
        rawId: typeof payload.id === "string" ? payload.id : undefined,
        usage: isJsonObject(payload.usage) ? (payload.usage as JsonValue) : undefined,
        finishReason: typeof payload.status === "string" ? payload.status : undefined,
      };
    },
  };
}

export function normalizeProviderBaseUrl(value: string): string {
  return trimTrailingSlash(value);
}
