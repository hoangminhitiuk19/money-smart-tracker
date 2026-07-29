import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { prismaRateLimitStore } from "@/lib/security/rate-limit-store";

const consumeScope = `integration-consume:${randomUUID()}`;
const cleanupScope = `integration-cleanup:${randomUUID()}`;

afterAll(async () => {
  await prisma.rateLimitBucket.deleteMany({
    where: { scope: { in: [consumeScope, cleanupScope] } }
  });
  await prisma.$disconnect();
});

describe("PostgreSQL rate-limit store", () => {
  it("atomically returns every count under concurrency", async () => {
    const bucket = {
      scope: consumeScope,
      identifierHash: "a".repeat(64),
      windowStart: new Date("2026-07-29T00:00:00.000Z"),
      expiresAt: new Date("2026-07-30T00:01:00.000Z")
    };
    const counts = await Promise.all(
      Array.from({ length: 25 }, () => prismaRateLimitStore.consume(bucket))
    );
    expect(counts.sort((left, right) => left - right)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
      14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25
    ]);
  });

  it("deletes no more than the requested number of expired rows", async () => {
    await prisma.rateLimitBucket.createMany({
      data: Array.from({ length: 501 }, (_, index) => ({
        scope: cleanupScope,
        identifierHash: index.toString(16).padStart(64, "0"),
        windowStart: new Date(0),
        count: 1,
        expiresAt: new Date("2000-01-01T00:00:00.000Z")
      }))
    });
    expect(
      await prismaRateLimitStore.cleanupExpired(
        new Date("2026-07-29T00:00:00.000Z"),
        500
      )
    ).toBe(500);
    expect(
      await prisma.rateLimitBucket.count({ where: { scope: cleanupScope } })
    ).toBe(1);
  });
});
