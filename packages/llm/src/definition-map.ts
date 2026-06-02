import { buildActorDefinition } from "typed-actors";
import type { AvenRegistry } from "../../runtime/src/spine.ts";
import type { LlmActorDefinitions } from "./actor-definitions.ts";
import type { LlmShapeBundle } from "./shape-support.ts";

export function buildLlmDefinitionMap(args: {
  readonly registry: AvenRegistry;
  readonly ActorKind: typeof import("../../runtime/src/spine.ts").ActorKind;
  readonly shapes: LlmShapeBundle;
  readonly support: LlmActorDefinitions;
}) {
  const { registry, ActorKind, shapes, support } = args;
  return {
    [ActorKind.Llms]: buildActorDefinition<typeof registry, typeof ActorKind.Llms, typeof shapes.llmsShape>(
      shapes.llmsShape,
      support.rootDefinition,
    ),
    [ActorKind.LlmProvider]: buildActorDefinition<typeof registry, typeof ActorKind.LlmProvider, typeof shapes.llmProviderShape>(
      shapes.llmProviderShape,
      support.providerDefinition,
    ),
    [ActorKind.LlmModel]: buildActorDefinition<typeof registry, typeof ActorKind.LlmModel, typeof shapes.llmModelShape>(
      shapes.llmModelShape,
      support.modelDefinition,
    ),
    [ActorKind.LlmRequestWorker]: buildActorDefinition<typeof registry, typeof ActorKind.LlmRequestWorker, typeof shapes.llmRequestWorkerShape>(
      shapes.llmRequestWorkerShape,
      support.requestWorkerDefinition,
    ),
  } as const;
}