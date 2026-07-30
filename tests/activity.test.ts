import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  activityRetentionCutoff,
  changedFields,
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
});
