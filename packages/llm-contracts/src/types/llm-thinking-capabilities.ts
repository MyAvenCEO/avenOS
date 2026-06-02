import type { JsonValue } from "typed-actors";

export type LlmThinkingCapabilities =
  | { readonly supported: false }
  | {
      readonly supported: true;
      readonly defaultEnabled: boolean;
      readonly enabledOptions?: JsonValue;
      readonly disabledOptions?: JsonValue;
    };