import type { ArtifactStorage } from "../../../artifacts/src/subsystem.ts";
import type { ArtifactDescriptor } from "artifact-contracts";
import type {
  ClassifiedError,
  LlmArtifactKind,
  LlmModelCapabilities,
  LlmProviderProtocol,
  LlmRequest,
} from "llm-contracts";
import type { JsonValue } from "typed-actors";
import type { LlmHttpClient } from "../client.ts";

export interface ResolvedLlmArtifactPart {
  readonly inputPart: Extract<LlmRequest["input"]["messages"][number]["content"][number], { readonly kind: "artifact" }>;
  readonly artifact: ArtifactDescriptor;
  readonly bytes: Uint8Array;
  readonly kind: LlmArtifactKind;
  readonly effectiveMimeType: string;
}

export interface ResolvedLlmRequest {
  readonly request: Omit<LlmRequest, "requestId"> & { readonly requestId: string };
  readonly artifacts: readonly ResolvedLlmArtifactPart[];
}

export interface AdapterExecutionOutput {
  readonly content: string;
  readonly model?: string;
  readonly usage?: JsonValue;
  readonly rawId?: string;
  readonly finishReason?: string;
}

export interface LlmProviderAdapter<ProviderRequest> {
  readonly protocol: LlmProviderProtocol;
  resolveArtifacts(input: {
    readonly request: Omit<LlmRequest, "requestId"> & { readonly requestId: string };
    readonly artifactStorage: ArtifactStorage | undefined;
  }): Promise<ResolvedLlmRequest | ClassifiedError>;
  validate(input: {
    readonly request: ResolvedLlmRequest;
    readonly capabilities: LlmModelCapabilities;
  }): ClassifiedError | undefined;
  compile(input: {
    readonly request: ResolvedLlmRequest;
    readonly capabilities: LlmModelCapabilities;
    readonly modelId: string;
    readonly structuredOutputSchema?: JsonValue;
  }): Promise<ProviderRequest>;
  execute(input: {
    readonly client: LlmHttpClient;
    readonly request: ProviderRequest;
  }): Promise<AdapterExecutionOutput>;
}