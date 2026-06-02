import type { JsonValue } from "typed-actors";

export interface HitlOption {
  readonly optionId: string;
  readonly label: string;
  readonly value?: JsonValue;
  readonly dangerous?: boolean;
}