import type { OptionalReplyableMessage } from "actor-contracts";
import type { LlmCapabilityRequirements } from "llm-contracts";
import type { StructuredExtractionScope } from "../types/structured-extraction-scope.ts";

export interface ExtractStructuredRequest extends OptionalReplyableMessage<"structuredExtractionRequest"> {
  readonly artifactId: string;
  readonly schemaId: string;
  readonly instruction?: string;
  readonly scope: StructuredExtractionScope;
  readonly requirements?: LlmCapabilityRequirements;
}