import type { ActorContext } from "typed-actors";
import type { AvenRegistry } from "../../runtime/src/spine.ts";
import type {
  LlmsMessage,
  LlmsState,
  LlmModelMessage,
  LlmRequestWorkerMessage,
  LlmProviderMessage,
} from "./actors/llms/types.ts";

export function createLlmActorDefinitions(args: {
  readonly registry: AvenRegistry;
  readonly ActorKind: typeof import("../../runtime/src/spine.ts").ActorKind;
  readonly rootPresent: () => { readonly title: string; readonly subtitle: string; };
  readonly rootHelpers: {
    readonly createDefaultState: () => LlmsState;
    readonly handleRootMessage: (
      ctx: ActorContext<typeof args.registry, typeof args.ActorKind.Llms>,
      message: LlmsMessage,
    ) => boolean;
  };
  readonly providerHelpers: {
    readonly spawnConfiguredProviders: (ctx: ActorContext<typeof args.registry, typeof args.ActorKind.Llms>) => void;
    readonly reconcileModelsOnStart: (ctx: ActorContext<typeof args.registry, typeof args.ActorKind.LlmProvider>) => Promise<void>;
    readonly handleListModelsMessage: (
      ctx: ActorContext<typeof args.registry, typeof args.ActorKind.LlmProvider>,
      message: LlmProviderMessage,
    ) => boolean;
  };
  readonly modelHelpers: {
    readonly handleMessage: (
      ctx: ActorContext<typeof args.registry, typeof args.ActorKind.LlmModel>,
      message: LlmModelMessage,
    ) => boolean;
  };
  readonly workerHelpers: {
    readonly handleMessage: (
      ctx: ActorContext<typeof args.registry, typeof args.ActorKind.LlmRequestWorker>,
      message: LlmRequestWorkerMessage,
    ) => Promise<boolean>;
  };
}) {
  const {
    registry,
    ActorKind,
    rootPresent,
    rootHelpers,
    providerHelpers,
    modelHelpers,
    workerHelpers,
  } = args;

  return {
    rootDefinition: {
      kind: ActorKind.Llms,
      init() { return { state: rootHelpers.createDefaultState(), behavior: "active" as const }; },
      onStart(ctx: ActorContext<typeof registry, typeof ActorKind.Llms>) { providerHelpers.spawnConfiguredProviders(ctx); },
      receive: {
        active(ctx: ActorContext<typeof registry, typeof ActorKind.Llms>, message: LlmsMessage) {
          rootHelpers.handleRootMessage(ctx, message);
        },
      },
      present() { return rootPresent(); },
    },
    providerDefinition: {
      kind: ActorKind.LlmProvider,
      async onStart(ctx: ActorContext<typeof registry, typeof ActorKind.LlmProvider>) {
        await providerHelpers.reconcileModelsOnStart(ctx);
      },
      receive: {
        async active(ctx: ActorContext<typeof registry, typeof ActorKind.LlmProvider>, message: LlmProviderMessage) {
          providerHelpers.handleListModelsMessage(ctx, message);
        },
      },
    },
    modelDefinition: {
      kind: ActorKind.LlmModel,
      receive: {
        active(ctx: ActorContext<typeof registry, typeof ActorKind.LlmModel>, message: LlmModelMessage) {
          modelHelpers.handleMessage(ctx, message);
        },
      },
    },
    requestWorkerDefinition: {
      kind: ActorKind.LlmRequestWorker,
      receive: {
        async active(ctx: ActorContext<typeof registry, typeof ActorKind.LlmRequestWorker>, message: LlmRequestWorkerMessage) {
          await workerHelpers.handleMessage(ctx, message);
        },
      },
    },
  };
}

export type LlmActorDefinitions = ReturnType<typeof createLlmActorDefinitions>;