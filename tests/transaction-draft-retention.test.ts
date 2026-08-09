import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupExpiredTransactionDrafts } from "@/lib/transaction-drafts/retention";

const findMany = vi.fn();
const deleteMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (operation: any) =>
      operation({ transactionDraft: { findMany, deleteMany } })
    )
  }
}));

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([
    { id: "draft-oldest", userId: "user-1" },
    { id: "draft-next", userId: "user-2" }
  ]);
  deleteMany.mockResolvedValue({ count: 2 });
});

describe("transaction draft retention", () => {
  it("selects a bounded oldest unresolved batch and deletes exactly those IDs", async () => {
    const now = new Date("2026-08-04T00:00:00.000Z");

    await expect(cleanupExpiredTransactionDrafts(now, 2)).resolves.toBe(2);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        expiresAt: { lte: now },
        status: { in: ["NEEDS_REVIEW", "READY"] }
      },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      select: { id: true, userId: true },
      take: 2
    });
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        expiresAt: { lte: now },
        status: { in: ["NEEDS_REVIEW", "READY"] },
        OR: [
          { id: "draft-oldest", userId: "user-1" },
          { id: "draft-next", userId: "user-2" }
        ]
      }
    });
  });

  it.each([0, 501, 1.5, Number.NaN])(
    "rejects invalid maximumRows %s before opening a transaction",
    async (maximumRows) => {
      await expect(
        cleanupExpiredTransactionDrafts(new Date(), maximumRows)
      ).rejects.toThrow();
      expect(findMany).not.toHaveBeenCalled();
    }
  );

  it("does not issue a delete when no expired rows are selected", async () => {
    findMany.mockResolvedValueOnce([]);

    await expect(cleanupExpiredTransactionDrafts()).resolves.toBe(0);
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
