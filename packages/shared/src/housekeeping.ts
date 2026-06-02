import { cloneJson, type JsonValue } from "typed-actors";

export interface InlineJsonLimitOptions {
  readonly maxBytes: number;
  readonly previewBytes?: number;
}

/**
 * Deep-clones a JSON-compatible value using the same semantics as other subsystem-local helpers.
 */
export function cloneJsonValue<T>(value: T): T {
  return cloneJson(value as JsonValue) as T;
}

export function deadlineAfter(now: Date, ttlMs: number): string {
  return new Date(now.getTime() + ttlMs).toISOString();
}

export function isExpired(deadlineAt: string, now: Date): boolean {
  return deadlineAt <= now.toISOString();
}

export function toInlineJsonPreview(value: JsonValue, options: InlineJsonLimitOptions): JsonValue {
  const text = JSON.stringify(value);
  const maxBytes = Math.max(1, options.maxBytes);
  const totalBytes = Buffer.byteLength(text, "utf8");
  if (totalBytes <= maxBytes) {
    return value;
  }
  const previewBytes = Math.min(Math.max(1, options.previewBytes ?? maxBytes), totalBytes);
  const preview = Buffer.from(text, "utf8").subarray(0, previewBytes).toString("utf8");
  return {
    type: "truncatedPreview",
    truncated: true,
    totalBytes,
    maxInlineResultBytes: maxBytes,
    preview,
  } as JsonValue;
}