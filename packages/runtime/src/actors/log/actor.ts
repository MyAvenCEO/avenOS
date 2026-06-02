import type { AppendInfrastructureLogMessage, InfrastructureLogEntry } from "../../../../actor-contracts/src/index.ts";
import { defineActor } from "typed-actors";
import type { AvenRegistry } from "../../spine.ts";
import { ActorKind } from "../../spine.ts";

const DEFAULT_RETENTION_LIMIT = 200;

export interface AvenLogActorState {
  readonly retentionLimit: number;
  readonly entries: readonly InfrastructureLogEntry[];
}

export interface AvenLogActorInit {
  readonly retentionLimit?: number;
}

function isAppendInfrastructureLogMessage(value: unknown): value is AppendInfrastructureLogMessage {
  return value !== null
    && typeof value === "object"
    && (value as { type?: unknown }).type === "appendInfrastructureLog"
    && typeof (value as { entry?: { id?: unknown } }).entry?.id === "string";
}

export function createAvenLogActor() {
  return defineActor<AvenRegistry, typeof ActorKind.Log>({
    kind: ActorKind.Log,
    init(input: AvenLogActorInit) {
      return {
        state: {
          retentionLimit: input.retentionLimit ?? DEFAULT_RETENTION_LIMIT,
          entries: [],
        },
        behavior: "active" as const,
      };
    },
    isMessage: isAppendInfrastructureLogMessage,
    receive: {
      active(ctx, message) {
        const next = [...ctx.state.entries, message.entry];
        ctx.setState({
          retentionLimit: ctx.state.retentionLimit,
          entries: next.slice(Math.max(0, next.length - ctx.state.retentionLimit)),
        });
      },
    },
    present() {
      return { title: "log", subtitle: "Infrastructure log" };
    },
  });
}