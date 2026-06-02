import type { LlmCapabilityRequirements } from "../types/llm-capability-requirements.ts";

export interface FindLlmsByCapabilitiesMessage {
  readonly type: "findLlmsByCapabilities";
  readonly requirements: LlmCapabilityRequirements;
}