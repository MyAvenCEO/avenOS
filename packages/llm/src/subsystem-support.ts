import type { ActorContext, JsonValue } from "typed-actors";
import type { AvenRegistry } from "../../runtime/src/spine.ts";
import type { BuildLlmSubsystemOptions } from "./actors/llms/types.ts";
import type { ProviderRuntime } from "./runtime-support.ts";
import { createLlmActorDefinitions, type LlmActorDefinitions } from "./actor-definitions.ts";
import { createLlmModelHelpers } from "./actors/provider/model-helpers.ts";
import { createLlmProviderHelpers } from "./actors/llms/provider-helpers.ts";
import { createLlmWorkerHelpers } from "./actors/request-worker/subsystem-helpers.ts";

export function createLlmSubsystemSupport(args: {
  readonly registry: AvenRegistry;
  readonly ActorKind: typeof import("../../runtime/src/spine.ts").ActorKind;
  readonly llmConfig: ReturnType<typeof import("./runtime-support.ts").resolveEffectiveConfig>;
  readonly providerRuntimes: Record<string, ProviderRuntime>;
  readonly llmRetention?: BuildLlmSubsystemOptions["llmRetention"];
  readonly artifactStorage?: BuildLlmSubsystemOptions["artifactStorage"];
}): LlmActorDefinitions {
  const { registry, ActorKind, llmConfig, providerRuntimes, artifactStorage } = args;

  const { providerHelpers, rootHelpers, rootPresent } = createLlmProviderHelpers({
    registry,
    ActorKind,
    llmConfig,
    providerRuntimes,
    llmRetention: args.llmRetention,
  });

  const modelHelpers = createLlmModelHelpers({
    registry,
    ActorKind,
  });

  const workerHelpers = createLlmWorkerHelpers({
    registry,
    ActorKind,
    providerRuntimes,
    artifactStorage,
  });

  return createLlmActorDefinitions({
    registry,
    ActorKind,
    rootPresent,
    rootHelpers,
    providerHelpers,
    modelHelpers,
    workerHelpers,
  });
}
