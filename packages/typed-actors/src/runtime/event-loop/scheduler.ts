export interface SchedulerHandle {
  stop(): void;
  wake(): void;
}

export interface SchedulerOptions {
  readonly idleBackoffMs: number;
  readonly concurrency: number;
  readonly onError: (error: unknown) => void;
}

export function startScheduler(
  callback: () => Promise<boolean>,
  options: SchedulerOptions,
): SchedulerHandle {
  const { idleBackoffMs, concurrency, onError } = options;
  let stopped = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const running = new Set<Promise<void>>();

  const scheduleWorker = (delayMs: number): void => {
    if (stopped) {
      return;
    }
    const timer = setTimeout(() => {
      timers.delete(timer);
      let runPromise: Promise<void> | undefined;
      runPromise = (async () => {
        try {
          const processed = await callback();
          scheduleWorker(processed ? 0 : idleBackoffMs);
        } catch (error) {
          onError(error);
          scheduleWorker(idleBackoffMs);
        } finally {
          if (runPromise) {
            running.delete(runPromise);
          }
        }
      })();
      running.add(runPromise);
    }, delayMs);
    timers.add(timer);
  };

  for (let index = 0; index < concurrency; index += 1) {
    scheduleWorker(0);
  }

  return {
    stop() {
      stopped = true;
      for (const timer of timers) {
        clearTimeout(timer);
      }
      timers.clear();
    },
    wake() {
      if (stopped) {
        return;
      }
      for (const timer of timers) {
        clearTimeout(timer);
      }
      timers.clear();
      const availableSlots = Math.max(concurrency - running.size, 0);
      for (let index = 0; index < availableSlots; index += 1) {
        scheduleWorker(0);
      }
    },
  };
}