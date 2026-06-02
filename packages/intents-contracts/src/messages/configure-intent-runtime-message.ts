import type { IntentRuntimeConfig } from "../types/intent-runtime-config.ts";

export interface ConfigureIntentRuntimeMessage {
  readonly type: "configureIntentRuntime";
  readonly runtimeConfig: IntentRuntimeConfig;
}