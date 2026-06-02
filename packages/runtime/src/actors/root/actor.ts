import { defineActor, type ActorContext } from "typed-actors";
import type { BuildLlmSubsystemOptions } from "../../../../llm/src/subsystem.ts";
import type { AvenRegistry } from "../../spine.ts";
import { ActorKind, defaultIntentRuntimeFromLlmConfig } from "../../spine.ts";

function spawnRootChildren(
  ctx: ActorContext<AvenRegistry, typeof ActorKind.Aven>,
  options?: BuildLlmSubsystemOptions,
): void {
  ctx.spawn(ActorKind.AvenSystem, { id: ctx.self.id.child("system"), init: {} });
  ctx.spawn(ActorKind.Intents, {
    id: ctx.self.id.child("intents"),
    init: {
      ...(defaultIntentRuntimeFromLlmConfig(options)
        ? { runtimeConfig: defaultIntentRuntimeFromLlmConfig(options) }
        : {}),
    },
  });
}

export function createAvenRootActor(options?: BuildLlmSubsystemOptions) {
  return defineActor<AvenRegistry, typeof ActorKind.Aven>({
    kind: ActorKind.Aven,
    init() {
      return { state: { ready: true as const }, behavior: "active" as const };
    },
    onStart(ctx: ActorContext<AvenRegistry, typeof ActorKind.Aven>) {
      spawnRootChildren(ctx, options);
    },
    receive: {
      active() {},
    },
    present() {
      return { title: "aven", subtitle: "Aven root" };
    },
  });
}
