import type { JsonValue } from "typed-actors";
import type { LlmCapabilityRequirements } from "llm-contracts";
import type { ReplyAddress } from "shared";

export interface CreateIntentMessage {
  readonly type: "createIntent";
  readonly requestId?: string;
  readonly replyTo?: ReplyAddress;
  readonly title?: string;
  readonly goal: string;
  readonly input?: JsonValue;
  readonly plannerRequirements?: LlmCapabilityRequirements;
  readonly plannerModelActorPathOverride?: string;
  readonly toolDefaults?: {
    readonly structuredExtraction?: {
      readonly requirements?: LlmCapabilityRequirements;
      readonly modelActorPathOverride?: string;
    };
  };
}