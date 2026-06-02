import { describe, expect, it } from "bun:test";
import {
  ActorId,
  InMemoryActorPersistence,
  actorType,
  createActorSystem,
  defineActor,
  defineRegistry,
} from "typed-actors";
import type { ArtifactDescriptor } from "artifact-contracts";
import type { CreateMetadataRecordMessage } from "metadata-contracts";
import type { ShellExecuteCompletion, ShellExecuteRequest, ShellToolConfig } from "../../../../shell-contracts/src/index.ts";
import { ShellActor, type ShellWorkerActorMessage, type ShellWorkerActorState } from "./actor.ts";

const ActorKind = {
  Shell: "shell",
  ShellWorker: "shellWorker",
  Metadata: "metadata",
  Capture: "capture",
} as const;

const Behavior = { Active: "active" } as const;

interface CaptureState {
  readonly completions: readonly ShellExecuteCompletion[];
}

type CaptureMessage = ShellExecuteCompletion;
type MetadataState = { readonly count: number };
type MetadataMessage = CreateMetadataRecordMessage;

const registry = defineRegistry({
  [ActorKind.Shell]: actorType<{}, ShellExecuteRequest, {}, typeof Behavior.Active, typeof ActorKind.ShellWorker>(),
  [ActorKind.ShellWorker]: actorType<ShellWorkerActorState, ShellWorkerActorMessage, ShellWorkerActorState, typeof Behavior.Active, never>(),
  [ActorKind.Metadata]: actorType<MetadataState, MetadataMessage, {}, typeof Behavior.Active, never>(),
  [ActorKind.Capture]: actorType<CaptureState, CaptureMessage, {}, typeof Behavior.Active, never>(),
});

class MemoryArtifactStorage {
  async putArtifact(input: {
    readonly bytes: Uint8Array;
    readonly declaredMimeType: string;
    readonly filename: string;
    readonly createdAt: string;
    readonly source: { readonly kind: "shellOutput"; readonly uri: string };
  }): Promise<ArtifactDescriptor> {
    const hash = `${input.filename}-${input.bytes.byteLength}-${Math.random().toString(36).slice(2, 10)}`;
    return {
      artifactId: `artifact~${hash}`,
      filename: input.filename,
      declaredMimeType: input.declaredMimeType,
      effectiveMimeType: input.declaredMimeType,
      createdAt: input.createdAt,
      blob: {
        hash,
        sizeBytes: input.bytes.byteLength,
      },
      source: input.source,
    };
  }
}

function createShellSystem() {
  const config: ShellToolConfig = {
    maxInlineOutputChars: 1024,
    maxMemoryBytes: 10_485_760,
    defaultTimeoutSeconds: 5,
    maxTimeoutSeconds: 30,
    cwd: process.cwd(),
    allowedCommands: [],
    env: {},
  };
  const shell = new ShellActor({
    registry,
    ActorKind,
    storage: new MemoryArtifactStorage(),
    config,
  });

  const system = createActorSystem({
    registry,
    persistence: new InMemoryActorPersistence(),
    runtime: {
      concurrency: 4,
      idleBackoffMs: 1,
      activationTimeoutMs: 30_000,
      leaseMs: 60_000,
    },
    definitions: {
      [ActorKind.Shell]: shell.buildDefinition(),
      [ActorKind.ShellWorker]: shell.buildWorkerDefinition(),
      [ActorKind.Metadata]: defineActor<typeof registry, typeof ActorKind.Metadata>({
        kind: ActorKind.Metadata,
        init: () => ({ state: { count: 0 }, behavior: Behavior.Active }),
        receive: {
          [Behavior.Active](ctx) {
            ctx.setState({ count: ctx.state.count + 1 });
          },
        },
      }),
      [ActorKind.Capture]: defineActor<typeof registry, typeof ActorKind.Capture>({
        kind: ActorKind.Capture,
        init: () => ({ state: { completions: [] }, behavior: Behavior.Active }),
        receive: {
          [Behavior.Active](ctx, message) {
            ctx.setState({ completions: [...ctx.state.completions, message] });
          },
        },
      }),
    },
  });

  return system;
}

async function waitForCompletions(system: ReturnType<typeof createShellSystem>, expectedCount: number, timeoutMs = 5_000): Promise<readonly ShellExecuteCompletion[]> {
  const captureId = ActorId.root("capture");
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const actor = await system.inspector.getActor(captureId);
    const completions = (actor?.actor.state as CaptureState | undefined)?.completions ?? [];
    if (completions.length >= expectedCount) {
      return completions;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${expectedCount} shell completions`);
}

describe("ShellActor concurrency", () => {
  it("processes concurrent shell requests in parallel without activation-buffer runtime failure", async () => {
    const system = createShellSystem();
    const shellRef = await system.createRoot(ActorKind.Shell, { id: ActorId.root("shell"), init: {} });
    await system.createRoot(ActorKind.Metadata, { id: ActorId.root("metadata"), init: {} });
    await system.createRoot(ActorKind.Capture, { id: ActorId.root("capture"), init: {} });
    await system.runUntilIdle();

    const replyTo = { actorId: "/capture", actorKind: ActorKind.Capture } as const;
    const startedAt = Date.now();

    await Promise.all([
      system.send(shellRef, {
        type: "shellExecuteRequest",
        requestId: "request-a",
        replyTo,
        command: "sleep 0.2; printf 'A'",
      }),
      system.send(shellRef, {
        type: "shellExecuteRequest",
        requestId: "request-b",
        replyTo,
        command: "sleep 0.2; printf 'B'",
      }),
    ]);

    system.start();
    const completions = await waitForCompletions(system, 2);
    const elapsedMs = Date.now() - startedAt;
    const runtimeSnapshot = system.eventLoop.getRuntimeSnapshot();

    expect(completions).toHaveLength(2);
    expect(completions.map((entry) => entry.requestId).sort()).toEqual(["request-a", "request-b"]);
    expect(completions.every((entry) => entry.result.exitCode === 0)).toBe(true);
    expect(elapsedMs).toBeLessThan(350);
    expect(runtimeSnapshot.lastError).toBeUndefined();

    await system.stop();
  });
});