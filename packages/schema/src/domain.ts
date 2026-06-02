import { createHash } from "node:crypto";
import type { JsonValue } from "typed-actors";
import type { RegisteredSchemaVersion, SchemaRef, SchemaResultRef, SchemaValidationResult } from "schema-contracts";

export type { RegisteredSchemaVersion, SchemaRef, SchemaResultRef, SchemaValidationResult } from "schema-contracts";

export function toSchemaRef(schemaId: string, version: string): SchemaRef {
  return { schemaId, version };
}

export function stableSchemaString(schema: unknown): string {
  return JSON.stringify(canonicalizeJson(schema as JsonValue));
}

export function hashSchema(schema: unknown): string {
  return createHash("sha256").update(stableSchemaString(schema)).digest("hex");
}

export function schemaError(
  schemaRef: SchemaResultRef | undefined,
  category: "schemaInvalid" | "schemaNotFound" | "invalidRequest",
  code: string,
  message: string,
  details?: unknown,
): SchemaValidationResult {
  return {
    type: "error",
    ...(schemaRef === undefined ? {} : { schemaRef }),
    error: {
      category,
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  };
}

export function compareSchemaVersions(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? "0";
    const rightPart = rightParts[index] ?? "0";
    const leftNumber = /^\d+$/u.test(leftPart) ? Number(leftPart) : Number.NaN;
    const rightNumber = /^\d+$/u.test(rightPart) ? Number(rightPart) : Number.NaN;
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
      return leftNumber - rightNumber;
    }
    if (leftPart !== rightPart) {
      return leftPart.localeCompare(rightPart);
    }
  }
  return left.localeCompare(right);
}

function canonicalizeJson(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeJson(entry));
  }
  const objectValue = value as Record<string, JsonValue>;
  const result: Record<string, JsonValue> = {};
  for (const key of Object.keys(objectValue).sort()) {
    result[key] = canonicalizeJson(objectValue[key]!);
  }
  return result;
}
