import type { JsonValue } from "typed-actors";
import type { CreateIntentMessage, IntentRuntimeConfig, RouteHumanMessage } from "intents-contracts";
import type { IntentSelectedModels } from "../../domain.ts";

export type IntentSelectionError = { readonly error: JsonValue };

export const defaultIntentPlannerSettings = {
  maxSteps: 8,
  maxPromptChars: 24000,
  maxObservationChars: 1500,
  toolCatalogMode: "compact",
  includeFullSchemaOnValidationError: true,
} as const;

export const defaultIntentToolSettings = {
  maxRuns: 8,
  artifactReadMaxBytes: 4096,
  shellInlinePreviewChars: 1024,
} as const;

const defaultPlannerRequirements: IntentSelectedModels["plannerRequirements"] = {
  input: { modalities: ["text"] },
  output: { modalities: ["text"] },
};

const defaultStructuredExtractionRequirements: NonNullable<IntentSelectedModels["toolDefaults"]>["structuredExtractionRequirements"] = {
  input: { modalities: ["text", "image"] },
  output: { modalities: ["text", "json"] },
  general: { requires: ["structuredOutput"] },
};

type IntentModelSelectionInput = Pick<
  CreateIntentMessage | RouteHumanMessage,
  "plannerRequirements" | "plannerModelActorPathOverride" | "toolDefaults"
>;

export function selectedModels(
  create: IntentModelSelectionInput,
  runtime: IntentRuntimeConfig | undefined,
  intentError: (category: "configuration", message: string, details?: JsonValue) => JsonValue,
): IntentSelectedModels | IntentSelectionError {
  if (
    runtime === undefined
    && create.plannerRequirements === undefined
    && create.plannerModelActorPathOverride === undefined
  ) {
    return {
      error: intentError(
        "configuration",
        "No intent LLM runtime defaults are available. Configure intent runtime at startup or provide an explicit planner model/path.",
      ),
    };
  }

  const plannerRequirements = create.plannerRequirements
    ?? runtime?.planner?.requirements
    ?? defaultPlannerRequirements;
  const plannerModelActorPathOverride = create.plannerModelActorPathOverride ?? runtime?.planner?.modelActorPathOverride;

  const structuredExtractionRequirements = create.toolDefaults?.structuredExtraction?.requirements
    ?? runtime?.toolDefaults?.structuredExtraction?.requirements
    ?? defaultStructuredExtractionRequirements;
  const structuredExtractionModelActorPathOverride = create.toolDefaults?.structuredExtraction?.modelActorPathOverride
    ?? runtime?.toolDefaults?.structuredExtraction?.modelActorPathOverride
    ;

  if (!plannerRequirements.input?.modalities?.length || !plannerRequirements.output?.modalities?.length) {
    return { error: intentError("configuration", "planner requirements must include input and output modalities.") };
  }

  return {
    plannerRequirements,
    ...(plannerModelActorPathOverride === undefined ? {} : { plannerModelActorPathOverride }),
    toolDefaults: {
      ...(structuredExtractionRequirements === undefined ? {} : { structuredExtractionRequirements }),
      ...(structuredExtractionModelActorPathOverride === undefined ? {} : { structuredExtractionModelActorPathOverride }),
    },
  };
}
