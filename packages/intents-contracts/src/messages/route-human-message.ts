import type { JsonValue } from "typed-actors";
import type { LlmCapabilityRequirements } from "llm-contracts";
import type { ReplyAddress } from "shared";

export interface RouteHumanMessage {
  readonly type: "routeHumanMessage";
  readonly requestId?: string;
  readonly replyTo?: ReplyAddress;
  readonly message: string;
  readonly attachments?: JsonValue;
  readonly plannerRequirements?: LlmCapabilityRequirements;
  readonly plannerModelActorPathOverride?: string;
  readonly toolDefaults?: {
    readonly structuredExtraction?: {
      readonly requirements?: LlmCapabilityRequirements;
      readonly modelActorPathOverride?: string;
    };
  };
}