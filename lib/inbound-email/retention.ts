import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { cleanupExpiredTransactionDrafts } from "@/lib/transaction-drafts/retention";

const maximumRowsSchema = z.number().int().min(1).max(500);

export async function cleanupExpiredInboundEmailData(
  now = new Date(),
  maximumRows = 500
): Promise<{ receiptsDeleted: number; draftsDeleted: number }> {
  const boundedMaximumRows = maximumRowsSchema.parse(maximumRows);

  const receiptsDeleted = await prisma.$transaction(async (db) => {
    const expired = await db.inboundEmailReceipt.findMany({
      where: { expiresAt: { lte: now } },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      select: { id: true, userId: true, mailboxId: true },
      take: boundedMaximumRows
    });

    if (expired.length === 0) {
      return 0;
    }

    const deleted = await db.inboundEmailReceipt.deleteMany({
      where: {
        expiresAt: { lte: now },
        OR: expired.map(({ id, userId, mailboxId }) => ({
          id,
          userId,
          mailboxId
        }))
      }
    });

    return deleted.count;
  });
  const draftsDeleted = await cleanupExpiredTransactionDrafts(
    now,
    boundedMaximumRows
  );

  return { receiptsDeleted, draftsDeleted };
}
