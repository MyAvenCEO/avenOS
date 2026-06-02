import type { ArtifactRef } from "artifact-contracts";

const ANSI_CSI_REGEX = /\x1b\[[0-9;]*[A-Za-z]/gu;
const ANSI_OSC_REGEX = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/gu;

export interface SanitizedPreview {
  readonly preview: string;
  readonly truncated: boolean;
}

export function sanitizeShellPreview(raw: string): string {
  return raw
    .replace(ANSI_CSI_REGEX, "")
    .replace(ANSI_OSC_REGEX, "")
    .replace(/\0/gu, "\uFFFD")
    .replace(/\n{5,}/gu, (match) => `\n...(${match.length - 1} blank lines omitted)...\n`);
}

export function truncateShellPreview(
  sanitized: string,
  maxInlineOutputChars: number,
  artifact?: ArtifactRef,
): SanitizedPreview {
  if (sanitized.length <= maxInlineOutputChars) {
    return { preview: sanitized, truncated: false };
  }
  const suffix = artifact
    ? `\n[truncated — full output in artifact ${artifact.artifactId}, ${artifact.blob.sizeBytes} bytes]`
    : "\n[truncated]";
  const safeLength = Math.max(0, maxInlineOutputChars - suffix.length);
  return {
    preview: `${sanitized.slice(0, safeLength)}${suffix}`,
    truncated: true,
  };
}

export function sanitizeAndTruncateShellPreview(
  raw: string,
  maxInlineOutputChars: number,
  artifact?: ArtifactRef,
): SanitizedPreview {
  return truncateShellPreview(sanitizeShellPreview(raw), maxInlineOutputChars, artifact);
}