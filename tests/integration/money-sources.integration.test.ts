import { randomUUID } from "node:crypto";
import {
  CardNetwork,
  FeeFrequency,
  MoneySourceType,
  WaiverPeriod
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  cleanupAuditContext,
  createAuditContext,
  type AuditContext
} from "@/tests/integration/helpers/audit-context";
import {
  createMoneySource,
  updateMoneySource
} from "@/lib/actions/money-sources";
import { prisma } from "@/lib/prisma";

const authState = vi.hoisted(() => ({ userId: "" }));

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => ({
    id: authState.userId,
    email: "money-source-audit@audit.invalid",
    name: "Money source audit user"
  }))
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn()
}));

vi.mock("@/lib/security/rate-limit", () => ({
  checkAuthenticatedMutation: vi.fn(async () => ({
    allowed: true,
    unavailable: false,
    limit: 60,
    remaining: 59,
    retryAfterSeconds: 60
  })),
  RATE_LIMIT_MESSAGE: "Too many requests. Please try again shortly."
}));

const contexts: AuditContext[] = [];
const moneyFieldCases = [
  "openingBalance",
  "creditLimit",
  "initialOutstandingDebt",
  "initialCardCredit",
  "annualFeeAmount",
  "annualFeeWaiverSpendTarget"
].flatMap((field) => [
  { field, value: "0.001" },
  { field, value: "99999999999999999.99" }
]);

afterAll(async () => {
  await Promise.all(contexts.map(cleanupAuditContext));
  await prisma.$disconnect();
});

describe("money source action persistence", () => {
  it("persists complete credit-card configuration without losing decimal precision", async () => {
    const context = await createAuditContext(
      `money-source-card-${randomUUID()}`
    );
    contexts.push(context);
    authState.userId = context.userA.id;

    const result = await createMoneySource({
      name: "Audit Card",
      type: MoneySourceType.CREDIT_CARD,
      providerName: "Audit Bank",
      displayIdentifier: "ending 1234",
      currency: "VND",
      openingBalance: "90071992547409.99",
      description: "Disposable integration fixture",
      isActive: true,
      creditLimit: "90071992547409.99",
      initialOutstandingDebt: "300.00",
      initialCardCredit: "100.00",
      cardLastFourDigits: "1234",
      cardNetwork: CardNetwork.VISA,
      openedDate: "2025-01-15",
      billingCycleDay: 15,
      paymentDueDay: 28,
      hasAnnualFee: true,
      annualFeeAmount: "250.00",
      annualFeeCurrency: "VND",
      annualFeeFrequency: FeeFrequency.YEARLY,
      annualFeeChargeDate: "2026-12-01",
      firstYearFeeWaived: true,
      freeYearsCount: 2,
      feeWaivedUntilDate: "2027-12-01",
      annualFeeWaiverEnabled: true,
      annualFeeWaiverSpendTarget: "1000.00",
      annualFeeWaiverPeriod: WaiverPeriod.YEARLY,
      waiverPeriodStartDate: "2026-01-01",
      waiverPeriodEndDate: "2026-12-31",
      annualFeeWaiverNote: "Retail purchases only"
    });

    expect(result).toEqual({ ok: true });
    const persisted = await prisma.moneySource.findFirstOrThrow({
      where: { userId: context.userA.id, name: "Audit Card" }
    });
    expect({
      ...persisted,
      openingBalance: persisted.openingBalance.toFixed(2),
      creditLimit: persisted.creditLimit?.toFixed(2),
      initialOutstandingDebt: persisted.initialOutstandingDebt.toFixed(2),
      initialCardCredit: persisted.initialCardCredit.toFixed(2),
      annualFeeAmount: persisted.annualFeeAmount?.toFixed(2),
      annualFeeWaiverSpendTarget:
        persisted.annualFeeWaiverSpendTarget?.toFixed(2)
    }).toMatchObject({
      userId: context.userA.id,
      name: "Audit Card",
      type: MoneySourceType.CREDIT_CARD,
      providerName: "Audit Bank",
      displayIdentifier: "ending 1234",
      currency: "VND",
      openingBalance: "90071992547409.99",
      description: "Disposable integration fixture",
      isActive: true,
      cardLastFourDigits: "1234",
      cardNetwork: CardNetwork.VISA,
      openedDate: new Date("2025-01-15T00:00:00.000Z"),
      creditLimit: "90071992547409.99",
      initialOutstandingDebt: "300.00",
      initialCardCredit: "100.00",
      billingCycleDay: 15,
      paymentDueDay: 28,
      hasAnnualFee: true,
      annualFeeAmount: "250.00",
      annualFeeCurrency: "VND",
      annualFeeChargeDate: new Date("2026-12-01T00:00:00.000Z"),
      annualFeeFrequency: FeeFrequency.YEARLY,
      firstYearFeeWaived: true,
      freeYearsCount: 2,
      feeWaivedUntilDate: new Date("2027-12-01T00:00:00.000Z"),
      annualFeeWaiverEnabled: true,
      annualFeeWaiverSpendTarget: "1000.00",
      annualFeeWaiverPeriod: WaiverPeriod.YEARLY,
      waiverPeriodStartDate: new Date("2026-01-01T00:00:00.000Z"),
      waiverPeriodEndDate: new Date("2026-12-31T00:00:00.000Z"),
      annualFeeWaiverNote: "Retail purchases only"
    });
    await expect(
      prisma.activityLog.count({
        where: {
          userId: context.userA.id,
          action: "MONEY_SOURCE_CREATED",
          entityId: persisted.id
        }
      })
    ).resolves.toBe(1);
  }, 20_000);
});

describe("money source Decimal(18,2) action rejection", () => {
  let context: AuditContext;

  beforeAll(async () => {
    context = await createAuditContext(
      `money-source-decimal-${randomUUID()}`
    );
    contexts.push(context);
  }, 20_000);

  it.each(moneyFieldCases)(
    "rejects create $field=$value before database or activity writes",
    async ({ field, value }) => {
      authState.userId = context.userA.id;
      const where = { userId: context.userA.id };
      const [moneySourcesBefore, activitiesBefore] = await Promise.all([
        prisma.moneySource.count({ where }),
        prisma.activityLog.count({ where })
      ]);

      const result = await createMoneySource({
        name: `Invalid create ${field} ${value}`,
        type: MoneySourceType.CREDIT_CARD,
        openingBalance: "25.00",
        creditLimit: "2000.00",
        initialOutstandingDebt: "300.00",
        initialCardCredit: "100.00",
        hasAnnualFee: true,
        annualFeeAmount: "250.00",
        annualFeeFrequency: FeeFrequency.YEARLY,
        annualFeeChargeDate: "2026-12-01",
        annualFeeWaiverEnabled: true,
        annualFeeWaiverSpendTarget: "1000.00",
        annualFeeWaiverPeriod: WaiverPeriod.YEARLY,
        waiverPeriodStartDate: "2026-01-01",
        waiverPeriodEndDate: "2026-12-31",
        [field]: value
      });

      expect(result).toEqual({
        ok: false,
        error: "Enter a valid account or wallet."
      });
      await expect(
        Promise.all([
          prisma.moneySource.count({ where }),
          prisma.activityLog.count({ where })
        ])
      ).resolves.toEqual([moneySourcesBefore, activitiesBefore]);
    },
    20_000
  );

  it.each(moneyFieldCases)(
    "rejects update $field=$value before database or activity writes",
    async ({ field, value }) => {
      authState.userId = context.userA.id;
      const source = await prisma.moneySource.create({
        data: {
          userId: context.userA.id,
          name: `Invalid update ${field} ${value}`,
          type: MoneySourceType.CREDIT_CARD,
          openingBalance: "25.00",
          creditLimit: "2000.00",
          initialOutstandingDebt: "300.00",
          initialCardCredit: "100.00",
          hasAnnualFee: true,
          annualFeeAmount: "250.00",
          annualFeeFrequency: FeeFrequency.YEARLY,
          annualFeeChargeDate: new Date("2026-12-01T00:00:00.000Z"),
          annualFeeWaiverEnabled: true,
          annualFeeWaiverSpendTarget: "1000.00",
          annualFeeWaiverPeriod: WaiverPeriod.YEARLY,
          waiverPeriodStartDate: new Date("2026-01-01T00:00:00.000Z"),
          waiverPeriodEndDate: new Date("2026-12-31T00:00:00.000Z")
        }
      });
      const activitiesBefore = await prisma.activityLog.count({
        where: { userId: context.userA.id, entityId: source.id }
      });

      const result = await updateMoneySource(source.id, { [field]: value });

      expect(result).toEqual({
        ok: false,
        error: "Enter a valid account or wallet."
      });
      await expect(
        Promise.all([
          prisma.moneySource.findUniqueOrThrow({ where: { id: source.id } }),
          prisma.activityLog.count({
            where: { userId: context.userA.id, entityId: source.id }
          })
        ])
      ).resolves.toEqual([source, activitiesBefore]);
    },
    20_000
  );
});
