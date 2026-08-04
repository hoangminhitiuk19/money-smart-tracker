import { z } from "zod";
import { prisma } from "@/lib/prisma";

const maximumRowsSchema = z.number().int().min(1).max(500);

export async function cleanupExpiredTransactionDrafts(
  now = new Date(),
  maximumRows = 500
): Promise<number> {
  const boundedMaximumRows = maximumRowsSchema.parse(maximumRows);

  return prisma.$transaction(async (db) => {
    const expired = await db.transactionDraft.findMany({
      where: {
        expiresAt: { lte: now },
        status: { in: ["NEEDS_REVIEW", "READY"] }
      },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      select: { id: true },
      take: boundedMaximumRows
    });

    if (expired.length === 0) {
      return 0;
    }

    const deleted = await db.transactionDraft.deleteMany({
      where: { id: { in: expired.map(({ id }) => id) } }
    });

    return deleted.count;
  });
}
