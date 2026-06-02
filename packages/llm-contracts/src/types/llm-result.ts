import type { JsonValue } from "typed-actors";
import type { ClassifiedError } from "./classified-error.ts";
import type { LlmOutputPart } from "./llm-output-part.ts";

export type LlmResult =
  | { readonly type: "ok"; readonly requestId: string; readonly output: readonly LlmOutputPart[]; readonly usage?: JsonValue }
  | { readonly type: "error"; readonly requestId: string; readonly error: ClassifiedError };