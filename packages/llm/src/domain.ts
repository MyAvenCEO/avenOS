import type { JsonValue } from "typed-actors";
import type { LlmGeneralCapability, LlmInputModality, LlmModelCapabilities } from "llm-contracts";
import { cloneJsonValue } from "../../shared/src/index.ts";

export type { LlmGeneralCapability, LlmInputModality, LlmModelCapabilities } from "llm-contracts";

export const defaultLlmModelCapabilities: LlmModelCapabilities = {
  input: {
    text: true,
    artifacts: [],
  },
  output: {
    modalities: ["text"],
  },
  general: {
    capabilities: [],
  },
};

function clone<T>(value: T): T {
  return cloneJsonValue(value);
}

export function normalizeLlmModelCapabilities(value?: LlmModelCapabilities): LlmModelCapabilities {
  if (!value) {
    return clone(defaultLlmModelCapabilities);
  }
  return {
    input: {
      text: value.input.text,
      ...(value.input.json === undefined ? {} : { json: value.input.json }),
      artifacts: value.input.artifacts.map((artifact) => ({
        kind: artifact.kind,
        mimeTypes: [...artifact.mimeTypes],
        transports: [...artifact.transports],
        ...(artifact.maxBytes === undefined ? {} : { maxBytes: artifact.maxBytes }),
        ...(artifact.maxCount === undefined ? {} : { maxCount: artifact.maxCount }),
      })),
      ...(value.input.maxTotalArtifactBytes === undefined ? {} : { maxTotalArtifactBytes: value.input.maxTotalArtifactBytes }),
    },
    output: {
      modalities: value.output.modalities.length > 0 ? [...value.output.modalities] : ["text"],
    },
    general: {
      capabilities: [...value.general.capabilities],
    },
  };
}
