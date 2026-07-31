import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  activityRetentionCutoff,
  changedFields,
  createActivityRetentionCleanupController,
  deleteExpiredActivity,
  retainedActivityWhere
} from "@/lib/activity";

describe("changedFields", () => {
  it("returns only requested persisted fields whose semantic values changed", () => {
    const before = {
      amount: "100.00",
      fromSourceId: null,
      title: "Before"
    };
    const after = {
      amount: "100.00",
      fromSourceId: null,
      title: "After"
    };

    expect(
      changedFields(before, after, ["amount", "fromSourceId", "title"])
    ).toEqual({
      title: ["Before", "After"]
    });
  });
});

describe("activity retention", () => {
  it("builds an inclusive 90-day read boundary for the authenticated user", () => {
    const now = new Date("2026-07-30T12:00:00.000Z");
    const cutoff = new Date("2026-05-01T12:00:00.000Z");

    expect(activityRetentionCutoff(now)).toEqual(cutoff);
    expect(retainedActivityWhere("user-1", "TRANSACTION_CREATED", now)).toEqual(
      {
        userId: "user-1",
        action: "TRANSACTION_CREATED",
        createdAt: { gte: cutoff }
      }
    );
  });

  it("deletes at most 500 oldest expired rows by their selected IDs", async () => {
    const cutoff = new Date("2026-05-01T12:00:00.000Z");
    const expired = Array.from({ length: 500 }, (_, index) => ({
      id: `expired-${index}`
    }));
    const findMany = vi.fn(async () => expired);
    const deleteMany = vi.fn(async () => ({ count: expired.length }));
    const db = {
      activityLog: { findMany, deleteMany }
    } as unknown as Prisma.TransactionClient;

    await expect(deleteExpiredActivity(db, cutoff, 900)).resolves.toBe(500);
    expect(findMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: cutoff } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
      take: 500
    });
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: expired.map(({ id }) => id) },
        createdAt: { lt: cutoff }
      }
    });
  });

  it("coalesces concurrent cleanup, cools down repeat renders, and contains cleanup failures", async () => {
    const now = new Date("2026-07-30T12:00:00.000Z");
    let releaseCleanup: ((count: number) => void) | undefined;
    const cleanup = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          releaseCleanup = resolve;
        })
    );
    const requestCleanup = createActivityRetentionCleanupController(cleanup, {
      minimumIntervalMs: 60 * 60 * 1000
    });

    const first = requestCleanup(now);
    const concurrent = requestCleanup(now);

    expect(concurrent).toBe(first);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledWith(
      new Date("2026-05-01T12:00:00.000Z")
    );
    releaseCleanup?.(12);
    await expect(first).resolves.toBe(true);

    await expect(
      requestCleanup(new Date("2026-07-30T12:30:00.000Z"))
    ).resolves.toBe(false);
    expect(cleanup).toHaveBeenCalledTimes(1);

    cleanup.mockRejectedValueOnce(new Error("cleanup unavailable"));
    await expect(
      requestCleanup(new Date("2026-07-30T13:00:00.000Z"))
    ).resolves.toBe(false);
    expect(cleanup).toHaveBeenCalledTimes(2);
  });
});
