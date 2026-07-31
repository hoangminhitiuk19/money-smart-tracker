import { randomUUID } from "node:crypto";
import {
  RenewalFrequency,
  TransactionType
} from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import {
  cleanupAuditContext,
  createAuditContext,
  type AuditContext
} from "@/tests/integration/helpers/audit-context";
import { seedDefaultCategories } from "@/lib/category-seed";
import { prisma } from "@/lib/prisma";

const contexts: AuditContext[] = [];

afterAll(async () => {
  await Promise.all(contexts.map(cleanupAuditContext));
  await prisma.$disconnect();
});

describe("renewal-generated transaction relationships", () => {
  it("rejects a transaction that references a missing renewal", async () => {
    const context = await createAuditContext(`schema-finance-fk-${randomUUID()}`);
    contexts.push(context);

    await expect(
      prisma.transaction.create({
        data: {
          userId: context.userA.id,
          type: TransactionType.INCOME,
          amount: "100.00",
          title: "Invalid renewal reference",
          transactionDate: new Date("2026-07-30T00:00:00.000Z"),
          recurringPaymentId: "missing-renewal"
        }
      })
    ).rejects.toMatchObject({ code: "P2003" });
  }, 20_000);

  it("preserves a generated transaction and clears its renewal reference on delete", async () => {
    const context = await createAuditContext(
      `schema-finance-set-null-${randomUUID()}`
    );
    contexts.push(context);
    const renewal = await prisma.recurringPayment.create({
      data: {
        userId: context.userA.id,
        title: "Monthly income",
        amount: "200.00",
        transactionType: TransactionType.INCOME,
        frequency: RenewalFrequency.MONTHLY,
        nextDueDate: new Date("2026-08-01T00:00:00.000Z")
      }
    });
    const generatedTransaction = await prisma.transaction.create({
      data: {
        userId: context.userA.id,
        type: TransactionType.INCOME,
        amount: "200.00",
        title: "Monthly income",
        transactionDate: new Date("2026-07-30T00:00:00.000Z"),
        recurringPaymentId: renewal.id
      }
    });

    await prisma.recurringPayment.delete({ where: { id: renewal.id } });

    await expect(
      prisma.transaction.findUnique({
        where: { id: generatedTransaction.id },
        select: { recurringPaymentId: true }
      })
    ).resolves.toEqual({ recurringPaymentId: null });
  }, 20_000);
});

describe("category fee-waiver defaults", () => {
  it("seeds Annual Fee as excluded from fee-waiver spending", async () => {
    const context = await createAuditContext(
      `schema-finance-category-${randomUUID()}`
    );
    contexts.push(context);

    await seedDefaultCategories(context.userA.id);

    await expect(
      prisma.category.findFirst({
        where: {
          userId: context.userA.id,
          name: "Annual Fee",
          isDefault: true
        },
        select: { defaultCountTowardFeeWaiver: true }
      })
    ).resolves.toEqual({ defaultCountTowardFeeWaiver: false });
  }, 20_000);
});
