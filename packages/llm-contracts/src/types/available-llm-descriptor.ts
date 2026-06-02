import type { LlmModelCapabilities } from "./llm-model-capabilities.ts";
import type { LlmPricing } from "./llm-pricing.ts";

export interface AvailableLlmDescriptor {
  readonly providerId: string;
  readonly modelId: string;
  readonly title: string;
  readonly modelActorPath: string;
  readonly capabilities: LlmModelCapabilities;
  readonly pricing?: LlmPricing;
  readonly availability: "available" | "unavailable";
  readonly source?: {
    readonly discovery?: "configured" | "discovered" | "merged";
    readonly configId?: string;
  };
}