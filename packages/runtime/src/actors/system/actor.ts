import { defineActor, type ActorContext } from "typed-actors";
import type { AvenRegistry } from "../../spine.ts";
import { ActorKind } from "../../spine.ts";

const DEFAULT_LOG_RETENTION_LIMIT = 200;

function spawnSystemChildren(
  ctx: ActorContext<AvenRegistry, typeof ActorKind.AvenSystem>,
): void {
  ctx.spawn(ActorKind.Log, { id: ctx.self.id.child("log"), init: { retentionLimit: DEFAULT_LOG_RETENTION_LIMIT } });
  ctx.spawn(ActorKind.RequestResults, { id: ctx.self.id.child("request-results"), init: {} });
  ctx.spawn(ActorKind.SchemaRegistry, { id: ctx.self.id.child("schemas"), init: { schemaIds: [] } });
  ctx.spawn(ActorKind.Artifacts, { id: ctx.self.id.child("artifacts"), init: {} });
  ctx.spawn(ActorKind.ArtifactReaderRegistry, { id: ctx.self.id.child("artifact-readers"), init: {} });
  ctx.spawn(ActorKind.Shell, { id: ctx.self.id.child("shell"), init: {} });
  ctx.spawn(ActorKind.Metadata, { id: ctx.self.id.child("metadata"), init: {} });
  ctx.spawn(ActorKind.Human, { id: ctx.self.id.child("human"), init: {} });
  ctx.spawn(ActorKind.StructuredExtraction, { id: ctx.self.id.child("structured-extraction"), init: {} });
  ctx.spawn(ActorKind.Llms, { id: ctx.self.id.child("llms"), init: {} });
}

export function createAvenSystemActor() {
  return defineActor<AvenRegistry, typeof ActorKind.AvenSystem>({
    kind: ActorKind.AvenSystem,
    init() {
      return { state: { ready: true as const }, behavior: "active" as const };
    },
    onStart(ctx: ActorContext<AvenRegistry, typeof ActorKind.AvenSystem>) {
      spawnSystemChildren(ctx);
    },
    receive: {
      active() {},
    },
    present() {
      return { title: "system", subtitle: "Aven system" };
    },
  });
}
