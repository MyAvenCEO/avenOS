import type { JsonValue } from "typed-actors";

export interface ClassifiedError {
  readonly category:
    | "artifactMissing"
    | "invalidRequest"
    | "queueFull"
    | "schemaInvalid"
    | "schemaNotFound"
    | "outputInvalid"
    | "providerError"
    | "unsupportedInputPart"
    | "modelCapability";
  readonly code: string;
  readonly message: string;
  readonly details?: JsonValue;
}