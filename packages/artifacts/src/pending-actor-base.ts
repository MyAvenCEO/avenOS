import type { JsonValue } from "typed-actors";
import type { ArtifactSubsystemSupport } from "./subsystem.ts";

export abstract class PendingArtifactActorBase<TPending extends { readonly deadlineAt: string }> {
  protected constructor(protected readonly support: ArtifactSubsystemSupport) {}

  protected cleanupPending<TState>(
    state: TState,
    pendingByRequestId: Readonly<Record<string, TPending>>,
    assign: (nextPending: Record<string, TPending>) => TState,
    now: Date,
  ): TState {
    const cleanup = this.support.cleanupPendingMap(pendingByRequestId, now);
    return assign(cleanup.nextPending);
  }

  protected pendingResult(requestId: string, awaiting: string): JsonValue {
    return { type: "pending", requestId, awaiting } as unknown as JsonValue;
  }

  protected nextRequestNumber(current: number, explicitRequestId?: string): number {
    return current + (explicitRequestId ? 0 : 1);
  }
}