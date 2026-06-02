import type { JsonValue } from "typed-actors";

export interface MetadataQueryFilter {
  readonly path: string;
  readonly op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "exists" | "contains";
  readonly value?: JsonValue;
}