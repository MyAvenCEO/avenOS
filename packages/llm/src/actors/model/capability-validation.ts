import type { JsonValue } from "typed-actors";
import type { BlobDescriptor } from "../../../../artifacts/src/subsystem.ts";
import type { ClassifiedError, LlmModelCapabilities, LlmRequest } from "llm-contracts";
import { clone, classifiedError, toJsonObject } from "../../support.ts";

export function validateThinking(
  capabilities: LlmModelCapabilities,
  thinking: "default" | "enabled" | "disabled" | undefined,
): ClassifiedError | undefined {
  const mode = thinking ?? "default";
  if (mode === "default" || capabilities.general.capabilities.includes("thinking")) return undefined;
  return classifiedError(
    "modelCapability",
    "LLM_THINKING_UNSUPPORTED",
    "Configured model does not support explicit thinking enable/disable.",
    { requestedThinking: mode },
  );
}

export function artifactRoleToModality(
  role: string | undefined,
): "image" | "audio" | "pdf" | "text" | undefined {
  switch (role) {
    case "image": return "image";
    case "audio": return "audio";
    case "pdf": return "pdf";
    case "text": return "text";
    default: return undefined;
  }
}

export function artifactDescriptorToDetails(descriptor: BlobDescriptor): JsonValue {
  return toJsonObject({
    ref: clone(descriptor.ref as unknown as JsonValue),
    effectiveMimeType: descriptor.effectiveMimeType,
    detectedMimeType: descriptor.detectedMimeType,
    createdAt: descriptor.createdAt,
  });
}

export function validateLlmInputAgainstCapabilities(
  capabilities: LlmModelCapabilities,
  request: Pick<LlmRequest, "input" | "thinking" | "responseSchema">,
): JsonValue {
  const thinkingError = validateThinking(capabilities, request.thinking);
  if (thinkingError) {
    return { type: "error", error: thinkingError } as unknown as JsonValue;
  }
  if (request.responseSchema && !capabilities.general.capabilities.includes("structuredOutput")) {
    return {
      type: "error",
      error: classifiedError(
        "modelCapability",
        "LLM_STRUCTURED_OUTPUT_UNSUPPORTED",
        "Configured model does not support structured JSON output required by responseSchema.",
        { responseSchema: clone(request.responseSchema as unknown as JsonValue) },
      ),
    } as unknown as JsonValue;
  }
  if (!capabilities.input.text) {
    return {
      type: "error",
      error: classifiedError("modelCapability", "LLM_TEXT_INPUT_UNSUPPORTED", "Model does not support text/json input parts."),
    } as unknown as JsonValue;
  }
  let artifactCount = 0;
  const artifactCounts = new Map<string, number>();
  for (const message of request.input.messages) {
    for (const part of message.content) {
      if (part.kind !== "artifact") continue;
      artifactCount += 1;
      if (capabilities.input.artifacts.length === 0) {
        return {
          type: "error",
          error: classifiedError(
            "modelCapability",
            "LLM_ARTIFACT_INPUT_UNSUPPORTED",
            "Configured model does not support artifact input parts.",
            { mediaRole: part.mediaRole ?? null, ref: clone(part.ref as unknown as JsonValue) },
          ),
        } as unknown as JsonValue;
      }
      const modality = artifactRoleToModality(part.mediaRole);
      if (!modality) {
        return {
          type: "error",
          error: classifiedError(
            "modelCapability",
            "LLM_ARTIFACT_MEDIA_ROLE_UNSUPPORTED",
            "Configured model received an unsupported artifact mediaRole.",
            { mediaRole: part.mediaRole ?? null },
          ),
        } as unknown as JsonValue;
      }
      const matchingCapability = capabilities.input.artifacts.find((artifact) => artifact.kind === modality);
      if (!matchingCapability) {
        return {
          type: "error",
          error: classifiedError(
            "modelCapability",
            "LLM_MODALITY_UNSUPPORTED",
            `Configured model does not support ${modality} inputs.`,
            { mediaRole: part.mediaRole ?? null },
          ),
        } as unknown as JsonValue;
      }
      artifactCounts.set(modality, (artifactCounts.get(modality) ?? 0) + 1);
    }
  }
  for (const [kind, count] of artifactCounts) {
    const matchingCapability = capabilities.input.artifacts.find((artifact) => artifact.kind === kind);
    if (matchingCapability?.maxCount !== undefined && count > matchingCapability.maxCount) {
      return {
        type: "error",
        error: classifiedError(
          "modelCapability",
          "LLM_TOO_MANY_ARTIFACTS",
          `Request contains ${count} '${kind}' artifact inputs, exceeding maxCount=${matchingCapability.maxCount}.`,
          { artifactCount, kind, count, maxCount: matchingCapability.maxCount },
        ),
      } as unknown as JsonValue;
    }
  }
  return {
    type: "ok",
    capabilities: clone(capabilities as unknown as JsonValue),
  } as unknown as JsonValue;
}
