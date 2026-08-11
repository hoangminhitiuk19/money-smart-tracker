import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupExpiredInboundEmailData } from "@/lib/inbound-email/retention";

const {
  receiptFindMany,
  receiptDeleteMany,
  cleanupDrafts,
  transaction
} = vi.hoisted(() => {
  const receiptFindMany = vi.fn();
  const receiptDeleteMany = vi.fn();
  const cleanupDrafts = vi.fn();
  const transaction = vi.fn(
    async (operation: (db: unknown) => Promise<unknown>) =>
      operation({
        inboundEmailReceipt: {
          findMany: receiptFindMany,
          deleteMany: receiptDeleteMany
        }
      })
  );
  return {
    receiptFindMany,
    receiptDeleteMany,
    cleanupDrafts,
    transaction
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: transaction }
}));

vi.mock("@/lib/transaction-drafts/retention", () => ({
  cleanupExpiredTransactionDrafts: cleanupDrafts
}));

beforeEach(() => {
  vi.resetAllMocks();
  transaction.mockImplementation(async (operation: (db: unknown) => Promise<unknown>) =>
    operation({
      inboundEmailReceipt: {
        findMany: receiptFindMany,
        deleteMany: receiptDeleteMany
      }
    })
  );
  receiptFindMany.mockResolvedValue([
    { id: "receipt-oldest", userId: "user-a", mailboxId: "mailbox-a" },
    { id: "receipt-next", userId: "user-b", mailboxId: "mailbox-b" }
  ]);
  receiptDeleteMany.mockResolvedValue({ count: 2 });
  cleanupDrafts.mockResolvedValue(1);
});

describe("inbound email retention", () => {
  it("deletes one bounded oldest receipt batch before cleaning eligible drafts", async () => {
    const now = new Date("2026-08-11T00:00:00.000Z");

    await expect(cleanupExpiredInboundEmailData(now, 2)).resolves.toEqual({
      receiptsDeleted: 2,
      draftsDeleted: 1
    });
    expect(receiptFindMany).toHaveBeenCalledWith({
      where: { expiresAt: { lte: now } },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      select: { id: true, userId: true, mailboxId: true },
      take: 2
    });
    expect(receiptDeleteMany).toHaveBeenCalledWith({
      where: {
        expiresAt: { lte: now },
        OR: [
          { id: "receipt-oldest", userId: "user-a", mailboxId: "mailbox-a" },
          { id: "receipt-next", userId: "user-b", mailboxId: "mailbox-b" }
        ]
      }
    });
    expect(cleanupDrafts).toHaveBeenCalledWith(now, 2);
    expect(receiptDeleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      cleanupDrafts.mock.invocationCallOrder[0]
    );
  });

  it.each([0, 501, 1.5, Number.NaN])(
    "rejects invalid maximumRows %s before database work",
    async (maximumRows) => {
      await expect(
        cleanupExpiredInboundEmailData(new Date(), maximumRows)
      ).rejects.toThrow();
      expect(transaction).not.toHaveBeenCalled();
      expect(cleanupDrafts).not.toHaveBeenCalled();
    }
  );

  it("still performs unresolved-draft cleanup when no receipt is eligible", async () => {
    receiptFindMany.mockResolvedValueOnce([]);
    cleanupDrafts.mockResolvedValueOnce(0);

    await expect(cleanupExpiredInboundEmailData()).resolves.toEqual({
      receiptsDeleted: 0,
      draftsDeleted: 0
    });
    expect(receiptDeleteMany).not.toHaveBeenCalled();
    expect(cleanupDrafts).toHaveBeenCalledTimes(1);
  });
});
