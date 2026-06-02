import type { ConfiguredLlmModel } from "./configured-llm-model.ts";
import type { LlmModelCapabilities } from "./llm-model-capabilities.ts";
import type { LlmProviderAuth } from "./llm-provider-auth.ts";
import type { LlmProviderProtocol } from "./llm-provider-protocol.ts";
import type { LlmPricing } from "./llm-pricing.ts";

export interface ConfiguredLlmProvider {
  readonly id: string;
  readonly title: string;
  readonly protocol: LlmProviderProtocol;
  readonly baseUrl: string;
  readonly auth: LlmProviderAuth;
  readonly discovery?: {
    readonly enabled?: boolean;
  };
  readonly modelDefaults?: {
    readonly capabilities?: LlmModelCapabilities;
    readonly pricing?: LlmPricing;
  };
  readonly models?: readonly ConfiguredLlmModel[];
}