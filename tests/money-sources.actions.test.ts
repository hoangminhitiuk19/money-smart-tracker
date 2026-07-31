import {
  CardNetwork,
  FeeFrequency,
  MoneySourceType,
  WaiverPeriod
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMoneySource,
  deleteMoneySource,
  deleteMoneySourceFormAction,
  toggleMoneySourceActiveFormAction,
  updateMoneySource
} from "@/lib/actions/money-sources";
import { prisma } from "@/lib/prisma";
import {
  checkAuthenticatedMutation,
  RATE_LIMIT_MESSAGE
} from "@/lib/security/rate-limit";

const mockUser = { id: "user-1", email: "user@test.com", name: "Test User" };

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => mockUser)
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

type FakeMoneySource = {
  id: string;
  userId: string;
  name: string;
  type: MoneySourceType;
  providerName: string | null;
  displayIdentifier: string | null;
  currency: string;
  openingBalance: string;
  description: string | null;
  isActive: boolean;
  cardLastFourDigits: string | null;
  cardNetwork: CardNetwork | null;
  openedDate: Date | null;
  creditLimit: string | null;
  initialOutstandingDebt: string;
  initialCardCredit: string;
  billingCycleDay: number | null;
  paymentDueDay: number | null;
  hasAnnualFee: boolean;
  annualFeeAmount: string | null;
  annualFeeCurrency: string;
  annualFeeChargeDate: Date | null;
  annualFeeFrequency: FeeFrequency | null;
  firstYearFeeWaived: boolean;
  freeYearsCount: number | null;
  feeWaivedUntilDate: Date | null;
  annualFeeWaiverEnabled: boolean;
  annualFeeWaiverSpendTarget: string | null;
  annualFeeWaiverPeriod: WaiverPeriod | null;
  waiverPeriodStartDate: Date | null;
  waiverPeriodEndDate: Date | null;
  annualFeeWaiverNote: string | null;
};

let moneySources: FakeMoneySource[];

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

function completeCreditCardInput() {
  return {
    name: "Audit Card",
    type: MoneySourceType.CREDIT_CARD,
    providerName: "Audit Bank",
    displayIdentifier: "ending 1234",
    currency: "VND",
    openingBalance: "25.00",
    description: "Primary audit card",
    isActive: true,
    cardLastFourDigits: "1234",
    cardNetwork: CardNetwork.VISA,
    openedDate: "2025-01-15",
    creditLimit: "2000.00",
    initialOutstandingDebt: "300.00",
    initialCardCredit: "100.00",
    billingCycleDay: 15,
    paymentDueDay: 28,
    hasAnnualFee: true,
    annualFeeAmount: "250.00",
    annualFeeCurrency: "VND",
    annualFeeChargeDate: "2026-12-01",
    annualFeeFrequency: FeeFrequency.YEARLY,
    firstYearFeeWaived: true,
    freeYearsCount: 2,
    feeWaivedUntilDate: "2027-12-01",
    annualFeeWaiverEnabled: true,
    annualFeeWaiverSpendTarget: "1000.00",
    annualFeeWaiverPeriod: WaiverPeriod.YEARLY,
    waiverPeriodStartDate: "2026-01-01",
    waiverPeriodEndDate: "2026-12-31",
    annualFeeWaiverNote: "Retail purchases only"
  };
}

function fakeCreditCard(): FakeMoneySource {
  return {
    id: "ms-card",
    userId: "user-1",
    name: "Existing Card",
    type: MoneySourceType.CREDIT_CARD,
    providerName: "Existing Bank",
    displayIdentifier: "ending 9876",
    currency: "VND",
    openingBalance: "0.00",
    description: "Keep when omitted",
    isActive: true,
    cardLastFourDigits: "9876",
    cardNetwork: CardNetwork.MASTERCARD,
    openedDate: new Date("2024-01-15T00:00:00.000Z"),
    creditLimit: "5000.00",
    initialOutstandingDebt: "400.00",
    initialCardCredit: "50.00",
    billingCycleDay: 10,
    paymentDueDay: 25,
    hasAnnualFee: true,
    annualFeeAmount: "200.00",
    annualFeeCurrency: "VND",
    annualFeeChargeDate: new Date("2026-11-01T00:00:00.000Z"),
    annualFeeFrequency: FeeFrequency.YEARLY,
    firstYearFeeWaived: true,
    freeYearsCount: 1,
    feeWaivedUntilDate: new Date("2026-10-31T00:00:00.000Z"),
    annualFeeWaiverEnabled: true,
    annualFeeWaiverSpendTarget: "1200.00",
    annualFeeWaiverPeriod: WaiverPeriod.YEARLY,
    waiverPeriodStartDate: new Date("2026-01-01T00:00:00.000Z"),
    waiverPeriodEndDate: new Date("2026-12-31T00:00:00.000Z"),
    annualFeeWaiverNote: "Existing waiver terms"
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (operation: any) =>
      operation((await import("@/lib/prisma")).prisma)
    ),
    moneySource: {
      findFirst: vi.fn(async ({ where }: any) => {
        const moneySource =
          moneySources.find(
            (m) => m.id === where.id && m.userId === where.userId
          ) ?? null;
        return moneySource ? { ...moneySource } : null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const record = { id: "new-money-source", ...data } as FakeMoneySource;
        moneySources.push(record);
        return { id: record.id, name: record.name, type: record.type };
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const target = moneySources.find(
          (m) => m.id === where.id && m.userId === where.userId
        );

        if (target) {
          Object.assign(target, data);
        }

        return { count: target ? 1 : 0 };
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        const before = moneySources.length;
        moneySources = moneySources.filter(
          (m) => !(m.id === where.id && m.userId === where.userId)
        );
        return { count: before - moneySources.length };
      })
    },
    transaction: {
      count: vi.fn(async () => 0)
    },
    activityLog: {
      create: vi.fn(async () => ({}))
    }
  }
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkAuthenticatedMutation).mockResolvedValue({
    allowed: true,
    unavailable: false,
    limit: 60,
    remaining: 59,
    retryAfterSeconds: 60
  });
  moneySources = [
    {
      id: "ms-1",
      userId: "user-1",
      name: "Cash Wallet",
      type: MoneySourceType.CASH,
      providerName: null,
      displayIdentifier: null,
      currency: "VND",
      openingBalance: "0.00",
      description: null,
      isActive: true,
      cardLastFourDigits: null,
      cardNetwork: null,
      openedDate: null,
      creditLimit: null,
      initialOutstandingDebt: "0.00",
      initialCardCredit: "0.00",
      billingCycleDay: null,
      paymentDueDay: null,
      hasAnnualFee: false,
      annualFeeAmount: null,
      annualFeeCurrency: "VND",
      annualFeeChargeDate: null,
      annualFeeFrequency: null,
      firstYearFeeWaived: false,
      freeYearsCount: null,
      feeWaivedUntilDate: null,
      annualFeeWaiverEnabled: false,
      annualFeeWaiverSpendTarget: null,
      annualFeeWaiverPeriod: null,
      waiverPeriodStartDate: null,
      waiverPeriodEndDate: null,
      annualFeeWaiverNote: null
    }
  ];
});

describe("money source mutation boundaries", () => {
  it("returns a safe delete failure through the bound form action", async () => {
    vi.mocked(checkAuthenticatedMutation).mockResolvedValueOnce({
      allowed: false,
      unavailable: false,
      limit: 60,
      remaining: 0,
      retryAfterSeconds: 60
    });

    await expect(deleteMoneySourceFormAction("ms-1")).resolves.toEqual({
      ok: false,
      error: RATE_LIMIT_MESSAGE
    });
  });

  it("denies a rate-limited create before creating a money source", async () => {
    vi.mocked(checkAuthenticatedMutation).mockResolvedValueOnce({
      allowed: false,
      unavailable: false,
      limit: 60,
      remaining: 0,
      retryAfterSeconds: 60
    });

    const result = await createMoneySource({
      name: "Savings",
      type: MoneySourceType.BANK_ACCOUNT
    });

    expect(result).toEqual({ ok: false, error: RATE_LIMIT_MESSAGE });
    expect(prisma.moneySource.create).not.toHaveBeenCalled();
  });

  it("consumes one rate-limit token when toggling a money source", async () => {
    await toggleMoneySourceActiveFormAction("ms-1", false, new FormData());

    expect(checkAuthenticatedMutation).toHaveBeenCalledTimes(1);
    expect(checkAuthenticatedMutation).toHaveBeenCalledWith("user-1");
  });

  it("writes a MONEY_SOURCE_DELETED activity log entry", async () => {
    const result = await deleteMoneySource("ms-1");

    expect(result.ok).toBe(true);
    expect(prisma.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          action: "MONEY_SOURCE_DELETED",
          entityId: "ms-1"
        })
      })
    );
  });

  it("writes exact §20.2 create metadata", async () => {
    await expect(
      createMoneySource({
        name: "Travel Cash",
        type: MoneySourceType.CASH
      })
    ).resolves.toEqual({ ok: true });

    expect(prisma.activityLog.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        action: "MONEY_SOURCE_CREATED",
        entityType: "MoneySource",
        entityId: "new-money-source",
        metadata: {
          name: "Travel Cash",
          type: MoneySourceType.CASH
        }
      }
    });
  });

  it("writes only persisted semantic changes for a non-card update", async () => {
    await expect(
      updateMoneySource("ms-1", { name: "Travel Cash" })
    ).resolves.toEqual({ ok: true });

    expect(prisma.activityLog.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        action: "MONEY_SOURCE_UPDATED",
        entityType: "MoneySource",
        entityId: "ms-1",
        metadata: {
          changedFields: {
            name: ["Cash Wallet", "Travel Cash"]
          }
        }
      }
    });
  });

  it("uses CREDIT_CARD_UPDATED with exact Decimal changedFields", async () => {
    moneySources.push(fakeCreditCard());

    await expect(
      updateMoneySource("ms-card", { creditLimit: "6000.00" })
    ).resolves.toEqual({ ok: true });

    expect(prisma.activityLog.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        action: "CREDIT_CARD_UPDATED",
        entityType: "MoneySource",
        entityId: "ms-card",
        metadata: {
          changedFields: {
            creditLimit: ["5000.00", "6000.00"]
          }
        }
      }
    });
  });
});

describe("credit-card configuration", () => {
  it("persists every supported credit-card, annual-fee, and waiver field", async () => {
    const result = await createMoneySource(completeCreditCardInput());

    expect(result).toEqual({ ok: true });
    expect(moneySources[1]).toEqual(
      expect.objectContaining({
        name: "Audit Card",
        type: MoneySourceType.CREDIT_CARD,
        providerName: "Audit Bank",
        displayIdentifier: "ending 1234",
        currency: "VND",
        openingBalance: "25.00",
        description: "Primary audit card",
        isActive: true,
        cardLastFourDigits: "1234",
        cardNetwork: CardNetwork.VISA,
        openedDate: new Date("2025-01-15T00:00:00.000Z"),
        creditLimit: "2000.00",
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
      })
    );
  });

  it.each([
    ["non-digit card identifier", { cardLastFourDigits: "12x4" }],
    ["one-digit card identifier", { cardLastFourDigits: "1" }],
    ["billing day below range", { billingCycleDay: 0 }],
    ["payment due day above range", { paymentDueDay: 32 }],
    ["fractional billing day", { billingCycleDay: 15.5 }],
    ["negative credit limit", { creditLimit: "-0.01" }],
    ["negative initial debt", { initialOutstandingDebt: "-0.01" }],
    ["negative initial card credit", { initialCardCredit: "-0.01" }],
    ["missing annual fee amount", { annualFeeAmount: undefined }],
    ["missing annual fee frequency", { annualFeeFrequency: undefined }],
    ["missing annual fee charge date", { annualFeeChargeDate: undefined }],
    ["zero waiver target", { annualFeeWaiverSpendTarget: "0" }],
    ["negative waiver target", { annualFeeWaiverSpendTarget: "-1" }],
    ["missing waiver period", { annualFeeWaiverPeriod: undefined }],
    ["missing waiver start date", { waiverPeriodStartDate: undefined }],
    ["missing waiver end date", { waiverPeriodEndDate: undefined }],
    ["invalid opened date", { openedDate: "2025-02-29" }],
    ["invalid annual fee date", { annualFeeChargeDate: "2026-02-31" }],
    [
      "waiver end before waiver start",
      {
        waiverPeriodStartDate: "2026-12-31",
        waiverPeriodEndDate: "2026-01-01"
      }
    ],
    ["negative free-year count", { freeYearsCount: -1 }],
    ["fractional free-year count", { freeYearsCount: 1.5 }],
    ["unreasonably large free-year count", { freeYearsCount: 101 }]
  ])("rejects %s without any writes", async (_label, override) => {
    const result = await createMoneySource({
      ...completeCreditCardInput(),
      ...override
    });

    expect(result).toEqual({
      ok: false,
      error: "Enter a valid account or wallet."
    });
    expect(moneySources).toHaveLength(1);
    expect(prisma.moneySource.create).not.toHaveBeenCalled();
    expect(prisma.activityLog.create).not.toHaveBeenCalled();
  });

  it("rejects card-only configuration on a non-card source without any writes", async () => {
    const result = await createMoneySource({
      name: "Cash with card fields",
      type: MoneySourceType.CASH,
      cardLastFourDigits: "1234"
    });

    expect(result).toEqual({
      ok: false,
      error: "Enter a valid account or wallet."
    });
    expect(moneySources).toHaveLength(1);
    expect(prisma.moneySource.create).not.toHaveBeenCalled();
    expect(prisma.activityLog.create).not.toHaveBeenCalled();
  });

  it("preserves omitted update fields and clears explicitly null fields", async () => {
    moneySources.push(fakeCreditCard());

    await expect(
      updateMoneySource("ms-card", { description: "Updated description" })
    ).resolves.toEqual({ ok: true });
    expect(moneySources[1]).toEqual(
      expect.objectContaining({
        providerName: "Existing Bank",
        creditLimit: "5000.00",
        description: "Updated description"
      })
    );

    await expect(
      updateMoneySource("ms-card", {
        providerName: null,
        creditLimit: null
      })
    ).resolves.toEqual({ ok: true });
    expect(moneySources[1]).toEqual(
      expect.objectContaining({
        providerName: null,
        creditLimit: null,
        description: "Updated description"
      })
    );
  });

  it("clears stale card, annual-fee, and waiver configuration when changing to a non-card", async () => {
    moneySources.push(fakeCreditCard());

    await expect(
      updateMoneySource("ms-card", { type: MoneySourceType.BANK_ACCOUNT })
    ).resolves.toEqual({ ok: true });
    expect(moneySources[1]).toEqual(
      expect.objectContaining({
        type: MoneySourceType.BANK_ACCOUNT,
        cardLastFourDigits: null,
        cardNetwork: null,
        openedDate: null,
        creditLimit: null,
        initialOutstandingDebt: "0",
        initialCardCredit: "0",
        billingCycleDay: null,
        paymentDueDay: null,
        hasAnnualFee: false,
        annualFeeAmount: null,
        annualFeeCurrency: "VND",
        annualFeeChargeDate: null,
        annualFeeFrequency: null,
        firstYearFeeWaived: false,
        freeYearsCount: null,
        feeWaivedUntilDate: null,
        annualFeeWaiverEnabled: false,
        annualFeeWaiverSpendTarget: null,
        annualFeeWaiverPeriod: null,
        waiverPeriodStartDate: null,
        waiverPeriodEndDate: null,
        annualFeeWaiverNote: null
      })
    );
  });

  it.each(moneyFieldCases)(
    "rejects create $field=$value outside Decimal(18,2) without any writes",
    async ({ field, value }) => {
      const result = await createMoneySource({
        ...completeCreditCardInput(),
        [field]: value
      });

      expect(result).toEqual({
        ok: false,
        error: "Enter a valid account or wallet."
      });
      expect(moneySources).toHaveLength(1);
      expect(prisma.moneySource.create).not.toHaveBeenCalled();
      expect(prisma.activityLog.create).not.toHaveBeenCalled();
    }
  );

  it.each(moneyFieldCases)(
    "rejects update $field=$value outside Decimal(18,2) without any writes",
    async ({ field, value }) => {
      moneySources.push(fakeCreditCard());

      const result = await updateMoneySource("ms-card", { [field]: value });

      expect(result).toEqual({
        ok: false,
        error: "Enter a valid account or wallet."
      });
      expect(moneySources).toHaveLength(2);
      expect(prisma.moneySource.updateMany).not.toHaveBeenCalled();
      expect(prisma.activityLog.create).not.toHaveBeenCalled();
    }
  );
});
