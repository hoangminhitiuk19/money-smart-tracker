import { FeeFrequency, MoneySourceType, WaiverPeriod } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  moneySourceSchema,
  moneySourceUpdateSchema
} from "@/lib/validation/money-source";

const moneyFields = [
  "openingBalance",
  "creditLimit",
  "initialOutstandingDebt",
  "initialCardCredit",
  "annualFeeAmount",
  "annualFeeWaiverSpendTarget"
] as const;

const invalidDecimalCases = moneyFields.flatMap((field) => [
  { field, reason: "more than two fractional digits", value: "0.001" },
  {
    field,
    reason: "more than sixteen integer digits",
    value: "99999999999999999.99"
  }
]);

function validCreditCardInput() {
  return {
    name: "Validation Card",
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
    waiverPeriodEndDate: "2026-12-31"
  };
}

describe("MoneySource Decimal(18,2) validation", () => {
  it.each(invalidDecimalCases)(
    "rejects $field with $reason on create",
    ({ field, value }) => {
      const result = moneySourceSchema.safeParse({
        ...validCreditCardInput(),
        [field]: value
      });

      expect(result.success).toBe(false);
    }
  );

  it.each(invalidDecimalCases)(
    "rejects $field with $reason on update",
    ({ field, value }) => {
      const result = moneySourceUpdateSchema.safeParse({ [field]: value });

      expect(result.success).toBe(false);
    }
  );

  it.each(moneyFields)(
    "accepts the maximum Decimal(18,2) value for $field on create and update",
    (field) => {
      const value = "9999999999999999.99";

      expect(
        moneySourceSchema.safeParse({
          ...validCreditCardInput(),
          [field]: value
        }).success
      ).toBe(true);
      expect(
        moneySourceUpdateSchema.safeParse({ [field]: value }).success
      ).toBe(true);
    }
  );
});
