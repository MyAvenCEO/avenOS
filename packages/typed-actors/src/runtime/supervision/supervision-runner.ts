import {
  FailedMessageAction,
  RuntimeEventType,
  SupervisionDirectiveType,
} from "../../core/constants.js";
import type { Clock } from "../../core/clock.js";
import { toIsoDateTimeString } from "../../core/ids.js";
import type { ActorRegistry, KindOf } from "../../registry/actor-type.js";
import type { ActorDefinition } from "../../registry/actor-definition.js";
import type { ActorContext } from "../activation/actor-context.js";
import { DefaultSupervisionPolicy } from "./default-supervision-policy.js";
import type { ActorFailure, SupervisionDirective } from "./supervision-types.js";
import type { RuntimeOptions } from "../runtime-options.js";
import type { ActorPersistence } from "../../persistence/actor-persistence.js";

export async function runSupervision<R extends ActorRegistry, K extends KindOf<R>>(
  definition: ActorDefinition<R, K>,
  ctx: ActorContext<R, K>,
  failure: ActorFailure,
  runtimeOptions: RuntimeOptions,
  persistence: ActorPersistence,
  clock: Clock,
): Promise<SupervisionDirective> {
  if (definition.supervise) {
    return definition.supervise(ctx, failure);
  }

  if (failure.envelope.attempt + 1 >= failure.envelope.maxAttempts) {
    return {
      type: SupervisionDirectiveType.Stop,
      failedMessage: FailedMessageAction.DeadLetter,
    };
  }

  const maxRestarts = runtimeOptions.supervision?.maxRestarts ?? DefaultSupervisionPolicy.MaxRestarts;
  const windowMs = runtimeOptions.supervision?.windowMs ?? DefaultSupervisionPolicy.WindowMs;
  const retryBackoffMs = runtimeOptions.supervision?.retryBackoffMs ?? DefaultSupervisionPolicy.RetryBackoffMs;

  const windowStart = new Date(clock.now().getTime() - windowMs);
  const snapshot = await persistence.readSnapshot({ includeEvents: true });
  const restartCountInWindow = snapshot.events.filter((event) => {
    return event.type === RuntimeEventType.SupervisionApplied
      && event.data.childId === failure.child.id
      && event.data.directive === SupervisionDirectiveType.Restart
      && event.createdAt >= toIsoDateTimeString(windowStart);
  }).length;

  if (restartCountInWindow < maxRestarts) {
    return {
      type: SupervisionDirectiveType.Restart,
      failedMessage: FailedMessageAction.Retry,
      backoffMs: retryBackoffMs,
    };
  }

  return {
    type: SupervisionDirectiveType.Stop,
    failedMessage: FailedMessageAction.DeadLetter,
  };
}