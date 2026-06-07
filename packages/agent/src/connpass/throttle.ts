export interface ThrottleClock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export const systemClock: ThrottleClock = {
  now: () => Date.now(),
  sleep: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
};

export type Throttle = <T>(task: () => Promise<T>) => Promise<T>;

/**
 * 直列キューに積み、前回実行から minIntervalMs 経過するまで待機してから実行する。
 * connpass API v2 のレート制限 (1 req/sec) を遵守するために使用する。
 */
export function createThrottler(minIntervalMs: number, clock: ThrottleClock = systemClock): Throttle {
  let queue = Promise.resolve();
  let lastRunAt = Number.NEGATIVE_INFINITY;

  return function throttle<T>(task: () => Promise<T>): Promise<T> {
    const scheduled = queue.then(async () => {
      const remaining = lastRunAt + minIntervalMs - clock.now();
      if (remaining > 0) {
        await clock.sleep(remaining);
      }
      lastRunAt = clock.now();
    });
    queue = scheduled;
    return scheduled.then(task);
  };
}
