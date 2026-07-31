import { randomUUID } from "node:crypto";
import {
  AdjustmentDirection,
  MoneySourceType,
  TransactionType
} from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { transactionDateRange } from "@/lib/date-range";
import {
  cleanupAuditContext,
  createAuditContext,
  type AuditContext
} from "@/tests/integration/helpers/audit-context";
import { prisma } from "@/lib/prisma";

const contexts: AuditContext[] = [];

afterAll(async () => {
  await Promise.all(contexts.map(cleanupAuditContext));
  await prisma.$disconnect();
});

describe("transaction date ranges", () => {
  it("includes both ends of an inclusive UTC calendar date and finds adjusted sources", async () => {
    const context = await createAuditContext(`date-ranges-${randomUUID()}`);
    contexts.push(context);
    const source = await prisma.moneySource.create({
      data: {
        userId: context.userA.id,
        name: "Date range fixture source",
        type: MoneySourceType.CASH
      }
    });
    const [atStart, atEnd, afterEnd] = await Promise.all([
      prisma.transaction.create({
        data: {
          userId: context.userA.id,
          type: TransactionType.ADJUSTMENT,
          amount: "10.00",
          title: "Range start adjustment",
          transactionDate: new Date("2026-07-30T00:00:00.000Z"),
          adjustedMoneySourceId: source.id,
          adjustmentDirection: AdjustmentDirection.INCREASE
        }
      }),
      prisma.transaction.create({
        data: {
          userId: context.userA.id,
          type: TransactionType.INCOME,
          amount: "20.00",
          title: "Range end income",
          transactionDate: new Date("2026-07-30T23:59:59.999Z"),
          toMoneySourceId: source.id
        }
      }),
      prisma.transaction.create({
        data: {
          userId: context.userA.id,
          type: TransactionType.INCOME,
          amount: "30.00",
          title: "Following midnight income",
          transactionDate: new Date("2026-07-31T00:00:00.000Z"),
          toMoneySourceId: source.id
        }
      })
    ]);
    const range = transactionDateRange("2026-07-01", "2026-07-30");
    const matchingDates = await prisma.transaction.findMany({
      where: { userId: context.userA.id, transactionDate: range },
      orderBy: { transactionDate: "asc" },
      select: { id: true }
    });
    const matchingSource = await prisma.transaction.findMany({
      where: {
        userId: context.userA.id,
        transactionDate: range,
        OR: [
          { fromMoneySourceId: source.id },
          { toMoneySourceId: source.id },
          { adjustedMoneySourceId: source.id }
        ]
      },
      select: { id: true }
    });

    expect(matchingDates.map((transaction) => transaction.id)).toEqual([
      atStart.id,
      atEnd.id
    ]);
    expect(matchingDates.map((transaction) => transaction.id)).not.toContain(
      afterEnd.id
    );
    expect(matchingSource.map((transaction) => transaction.id)).toContain(atStart.id);
  }, 20_000);
});
