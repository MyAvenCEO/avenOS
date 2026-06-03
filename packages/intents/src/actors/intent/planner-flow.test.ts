import { describe, expect, it } from "bun:test";
import { buildPlannerPrompt, parseIntentNextAction } from "./planner-flow.ts";
import { listIntentToolCatalog } from "./tool-catalog.ts";
import type { IntentActorState } from "./types.ts";

function state(): IntentActorState {
  return {
    intentId: "intent~1",
    title: "Process invoice",
    goal: "Process invoice",
    input: {
      attachments: [{
        filename: "invoice.png",
        effectiveMimeType: "image/png",
        declaredMimeType: "image/png",
        mediaRole: "image",
        ref: { artifactId: "artifact-1", blob: { algorithm: "sha256", hash: "hash-1", sizeBytes: 123 } },
      }],
    },
    requiresHumanVisibleResult: true,
    durable: false,
    status: "running",
    timeline: [],
    observations: [],
    humanAnswers: [],
    shellContext: { user: "daniel", home: "/home/daniel", cwd: "/tmp", platform: "linux" },
    selectedModels: { plannerRequirements: { input: { modalities: ["text"] }, output: { modalities: ["text"] } }, toolDefaults: {} },
    plannerSettings: { maxSteps: 8, maxPromptChars: 50_000, maxObservationChars: 1500, toolCatalogMode: "compact", includeFullSchemaOnValidationError: true },
    toolSettings: { maxRuns: 8, artifactReadMaxBytes: 4096, shellInlinePreviewChars: 1024 },
    currentStep: 1,
    toolRuns: 0,
  };
}

describe("planner structured extraction prompt and parsing", () => {
  it("includes availableArtifacts, availableExtractionSchemas, and new tool instructions", () => {
    const prompt = buildPlannerPrompt(state(), {
      sanitizeJson: (v) => v,
      bounded: (v) => v,
      listIntentToolCatalog: () => listIntentToolCatalog({ IntentToolRunKind: "intentToolRun", clone: structuredClone, sanitizeJson: (v) => v, bounded: (v) => v }),
    });
    expect(prompt).toContain("availableArtifacts");
    expect(prompt).toContain("availableExtractionSchemas");
    expect(prompt).toContain("structuredExtraction.extract");
    expect(prompt).not.toContain("llm.extractStructuredFromArtifact");
    expect(prompt).toContain("Never include blob, ref, mediaRole, schema, schemaRef, version");
  });

  it("accepts the new extraction tool and rejects the legacy name in repaired tool shapes", () => {
    const parsed = parseIntentNextAction({ kind: "structuredExtraction.extract", artifactId: "artifact-1", schemaId: "invoice" });
    expect(parsed).toEqual({ type: "ok", value: { kind: "callTool", toolId: "structuredExtraction.extract", input: { artifactId: "artifact-1", schemaId: "invoice" } } });
    const legacy = parseIntentNextAction({ kind: "llm.extractStructuredFromArtifact", artifactId: "artifact-1", schemaId: "invoice" });
    expect(legacy.type).toBe("error");
  });

  it("warns against repeating the same failed tool call and duplicate notifyHuman loops", () => {
    const prompt = buildPlannerPrompt(state(), {
      sanitizeJson: (v) => v,
      bounded: (v) => v,
      listIntentToolCatalog: () => listIntentToolCatalog({ IntentToolRunKind: "intentToolRun", clone: structuredClone, sanitizeJson: (v) => v, bounded: (v) => v }),
    });
    expect(prompt).toContain("Do not repeat the same tool call after an error with the same input unless you have new evidence");
    expect(prompt).toContain("If a tool error is already human-visible via notifyHuman, do not emit another notifyHuman with the same underlying error");
  });

	it("instructs the planner to use shell.execute for local machine facts like time and user identity", () => {
		const prompt = buildPlannerPrompt(state(), {
			sanitizeJson: (v) => v,
			bounded: (v) => v,
			listIntentToolCatalog: () => listIntentToolCatalog({ IntentToolRunKind: "intentToolRun", clone: structuredClone, sanitizeJson: (v) => v, bounded: (v) => v }),
		});
		expect(prompt).toContain("If the request depends on the current local machine")
		expect(prompt).toContain("preferably shell.execute")
		expect(prompt).toContain("For local factual questions like 'what time is it', 'who am I'")
	});
});