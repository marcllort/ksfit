import { describe, it, expect } from "vitest";
import { withCache, invalidate } from "../cache";

describe("withCache", () => {
  it("caches within the TTL and re-fetches after it expires", async () => {
    const key = `t:ttl:${Math.random()}`;
    let calls = 0;
    const fn = () => Promise.resolve(++calls);

    expect(await withCache(key, 10_000, fn)).toBe(1);
    expect(await withCache(key, 10_000, fn)).toBe(1); // hit
    expect(calls).toBe(1);

    // TTL of 0 forces a miss.
    expect(await withCache(key, 0, fn)).toBe(2);
    invalidate(key);
  });

  it("dedupes concurrent misses onto a single upstream call (stampede guard)", async () => {
    const key = `t:stampede:${Math.random()}`;
    let calls = 0;
    let release!: (v: number) => void;
    const gate = new Promise<number>((r) => (release = r));
    const fn = () => {
      calls++;
      return gate;
    };

    // Fire 5 concurrent misses before the first resolves.
    const all = Promise.all(
      Array.from({ length: 5 }, () => withCache(key, 10_000, fn)),
    );
    release(42);
    const results = await all;

    expect(calls).toBe(1); // only one upstream call
    expect(results).toEqual([42, 42, 42, 42, 42]);
    invalidate(key);
  });

  it("does not cache a rejected call (lets the next attempt retry)", async () => {
    const key = `t:reject:${Math.random()}`;
    let calls = 0;
    const fn = () => {
      calls++;
      return calls === 1
        ? Promise.reject(new Error("boom"))
        : Promise.resolve("ok");
    };

    await expect(withCache(key, 10_000, fn)).rejects.toThrow("boom");
    expect(await withCache(key, 10_000, fn)).toBe("ok");
    expect(calls).toBe(2);
    invalidate(key);
  });
});
