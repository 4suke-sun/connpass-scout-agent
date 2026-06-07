import { describe, expect, it } from "vitest";
import { createThrottler, type ThrottleClock } from "./throttle.js";

function createFakeClock(initialNow: number): {
  clock: ThrottleClock;
  sleptMs: number[];
  advance: (ms: number) => void;
} {
  let current = initialNow;
  const sleptMs: number[] = [];
  const clock: ThrottleClock = {
    now: () => current,
    sleep: async (ms) => {
      sleptMs.push(ms);
      current += ms;
    },
  };
  return {
    clock,
    sleptMs,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe("createThrottler", () => {
  it("初回実行の場合_待機せずにタスクを実行する", async () => {
    const { clock, sleptMs } = createFakeClock(0);
    const throttle = createThrottler(1000, clock);

    const result = await throttle(async () => "first");

    expect(result).toBe("first");
    expect(sleptMs).toEqual([]);
  });

  it("最小間隔より短い間隔で連続実行した場合_不足分だけ待機してから実行する", async () => {
    const { clock, sleptMs } = createFakeClock(0);
    const throttle = createThrottler(1000, clock);

    await throttle(async () => "first");
    await throttle(async () => "second");

    expect(sleptMs).toEqual([1000]);
  });

  it("最小間隔以上の間隔が空いている場合_待機せずに実行する", async () => {
    const { clock, sleptMs, advance } = createFakeClock(0);
    const throttle = createThrottler(1000, clock);

    await throttle(async () => "first");
    advance(1500);
    await throttle(async () => "second");

    expect(sleptMs).toEqual([]);
  });

  it("複数タスクを同時に積んだ場合_呼び出した順に直列実行される", async () => {
    const { clock } = createFakeClock(0);
    const throttle = createThrottler(1000, clock);
    const order: string[] = [];

    await Promise.all([
      throttle(async () => {
        order.push("a");
      }),
      throttle(async () => {
        order.push("b");
      }),
      throttle(async () => {
        order.push("c");
      }),
    ]);

    expect(order).toEqual(["a", "b", "c"]);
  });

  it("タスクが失敗した場合_後続タスクのスケジューリングに影響しない", async () => {
    const { clock, sleptMs } = createFakeClock(0);
    const throttle = createThrottler(1000, clock);

    await expect(
      throttle(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const result = await throttle(async () => "after-failure");

    expect(result).toBe("after-failure");
    expect(sleptMs).toEqual([1000]);
  });
});
