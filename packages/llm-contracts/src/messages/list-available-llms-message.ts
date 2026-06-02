import type { LlmCapabilityRequirements } from "../types/llm-capability-requirements.ts";

export interface ListAvailableLlmsMessage {
  readonly type: "listAvailableLlms";
  readonly requirements?: LlmCapabilityRequirements;
}