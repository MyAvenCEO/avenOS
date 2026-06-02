import type { AvenRegistry } from "../../runtime/src/spine.ts";
import type { BuildLlmSubsystemOptions } from "./actors/llms/types.ts";
import { prepareLlmSubsystemRuntime } from "./runtime-support.ts";
import { buildLlmDefinitionMap } from "./definition-map.ts";
import { createLlmShapeBundle, type LlmShapeBundle } from "./shape-support.ts";
import { createLlmSubsystemSupport } from "./subsystem-support.ts";

export function buildPreparedLlmSubsystemBundle(args: {
  readonly registry: AvenRegistry;
  readonly ActorKind: typeof import("../../runtime/src/spine.ts").ActorKind;
  readonly options?: BuildLlmSubsystemOptions;
  readonly shapes?: LlmShapeBundle;
}) {
  const { registry, ActorKind, options } = args;
  const shapes = args.shapes ?? createLlmShapeBundle();
  const { llmConfig, artifactStorage, providerRuntimes, llmRetention } = prepareLlmSubsystemRuntime({ options });
  const support = createLlmSubsystemSupport({
    registry,
    ActorKind,
    llmConfig,
    providerRuntimes,
    llmRetention,
    artifactStorage,
  });
  const definitions = buildLlmDefinitionMap({
    registry,
    ActorKind,
    shapes,
    support,
  });
  return {
    definitions,
    presentations: {},
  };
}
