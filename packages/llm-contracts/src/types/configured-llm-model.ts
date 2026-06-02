import type { LlmModelCapabilities } from "./llm-model-capabilities.ts";
import type { LlmPricing } from "./llm-pricing.ts";

export interface ConfiguredLlmModel {
  readonly modelId: string;
  readonly configId?: string;
  readonly title?: string;
  readonly capabilities?: LlmModelCapabilities;
  readonly pricing?: LlmPricing;
}