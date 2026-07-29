import { describe, expect, it, vi } from "vitest";
import {
  consumeRateLimit,
  hashRateLimitIdentifier,
  type RateLimitStore
} from "@/lib/security/rate-limit-core";

const policy = { scope: "test", limit: 2, windowMs: 60_000 };
const secret = "0123456789abcdef0123456789abcdef";

function storeReturning(...counts: number[]): RateLimitStore {
  return {
    consume: vi.fn(async () => counts.shift() ?? 1),
    cleanupExpired: vi.fn(async () => 0)
  };
}

describe("rate limiting", () => {
  it("hashes a normalized namespaced identifier without exposing it", () => {
    const first = hashRateLimitIdentifier("login:email", " USER@Example.com ", secret);
    const second = hashRateLimitIdentifier("login:email", "user@example.com", secret);
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain("user@example.com");
    expect(hashRateLimitIdentifier("register:email", "user@example.com", secret))
      .not.toBe(first);
  });

  it("allows through the limit and denies the next request", async () => {
    const store = storeReturning(1, 2, 3);
    const at = new Date("2026-07-29T00:00:30.000Z");
    await expect(consumeRateLimit(policy, "user", { store, secret, now: () => at }))
      .resolves.toMatchObject({ allowed: true, remaining: 1 });
    await expect(consumeRateLimit(policy, "user", { store, secret, now: () => at }))
      .resolves.toMatchObject({ allowed: true, remaining: 0 });
    await expect(consumeRateLimit(policy, "user", { store, secret, now: () => at }))
      .resolves.toMatchObject({ allowed: false, remaining: 0, retryAfterSeconds: 30 });
  });

  it("fails closed when storage is unavailable", async () => {
    const store: RateLimitStore = {
      consume: vi.fn(async () => {
        throw new Error("database detail that must not escape");
      }),
      cleanupExpired: vi.fn(async () => 0)
    };
    await expect(
      consumeRateLimit(policy, "user", {
        store,
        secret,
        now: () => new Date("2026-07-29T00:00:30.000Z")
      })
    ).resolves.toMatchObject({ allowed: false, unavailable: true });
  });

  it("runs bounded cleanup only for a newly created bucket", async () => {
    const store = storeReturning(1, 2);
    const at = new Date("2026-07-29T00:00:30.000Z");
    await consumeRateLimit(policy, "user", { store, secret, now: () => at });
    await consumeRateLimit(policy, "user", { store, secret, now: () => at });
    expect(store.cleanupExpired).toHaveBeenCalledTimes(1);
    expect(store.cleanupExpired).toHaveBeenCalledWith(at, 500);
  });

  it("keeps the allowed decision when best-effort cleanup rejects", async () => {
    const store: RateLimitStore = {
      consume: vi.fn(async () => 1),
      cleanupExpired: vi.fn(async () => {
        throw new Error("cleanup database detail");
      })
    };

    await expect(
      consumeRateLimit(policy, "user", {
        store,
        secret,
        now: () => new Date("2026-07-29T00:00:30.000Z")
      })
    ).resolves.toEqual({
      allowed: true,
      unavailable: false,
      limit: 2,
      remaining: 1,
      retryAfterSeconds: 30
    });
  });
});
