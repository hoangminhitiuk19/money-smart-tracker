import { RenewalFrequency } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  calculateNextDueDate,
  calculatePaidRenewalCycle,
  calculateSkippedRenewalCycle
} from "@/lib/calc/renewals";

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

describe("calculateNextDueDate", () => {
  it("adds days for DAILY", () => {
    expect(
      isoDate(
        calculateNextDueDate(
          new Date("2026-01-10T00:00:00.000Z"),
          RenewalFrequency.DAILY,
          3
        )
      )
    ).toBe("2026-01-13");
  });

  it("adds intervalCount times seven days for WEEKLY", () => {
    expect(
      isoDate(
        calculateNextDueDate(
          new Date("2026-01-10T00:00:00.000Z"),
          RenewalFrequency.WEEKLY,
          2
        )
      )
    ).toBe("2026-01-24");
  });

  it("adds months for MONTHLY", () => {
    expect(
      isoDate(
        calculateNextDueDate(
          new Date("2026-01-10T00:00:00.000Z"),
          RenewalFrequency.MONTHLY,
          1
        )
      )
    ).toBe("2026-02-10");
  });

  it("adds years for YEARLY", () => {
    expect(
      isoDate(
        calculateNextDueDate(
          new Date("2026-01-10T00:00:00.000Z"),
          RenewalFrequency.YEARLY,
          1
        )
      )
    ).toBe("2027-01-10");
  });

  it("adds two months when intervalCount is 2", () => {
    expect(
      isoDate(
        calculateNextDueDate(
          new Date("2026-01-10T00:00:00.000Z"),
          RenewalFrequency.MONTHLY,
          2
        )
      )
    ).toBe("2026-03-10");
  });

  it("CUSTOM behaves as DAILY for MVP", () => {
    expect(
      isoDate(
        calculateNextDueDate(
          new Date("2026-01-10T00:00:00.000Z"),
          RenewalFrequency.CUSTOM,
          4
        )
      )
    ).toBe("2026-01-14");
  });

  it("clamps MONTHLY to the last day of a shorter target month instead of overflowing", () => {
    expect(
      isoDate(
        calculateNextDueDate(
          new Date("2026-01-31T00:00:00.000Z"),
          RenewalFrequency.MONTHLY,
          1
        )
      )
    ).toBe("2026-02-28");
  });

  it("clamps YEARLY Feb 29 to Feb 28 when the target year is not a leap year", () => {
    expect(
      isoDate(
        calculateNextDueDate(
          new Date("2024-02-29T00:00:00.000Z"),
          RenewalFrequency.YEARLY,
          1
        )
      )
    ).toBe("2025-02-28");
  });

  it("keeps Feb 29 when the target year is also a leap year", () => {
    expect(
      isoDate(
        calculateNextDueDate(
          new Date("2024-02-29T00:00:00.000Z"),
          RenewalFrequency.YEARLY,
          4
        )
      )
    ).toBe("2028-02-29");
  });
});

describe("renewal cycle helpers", () => {
  it("markRenewalAsPaid advances exactly one cycle even if result is still in the past", () => {
    const result = calculatePaidRenewalCycle({
      frequency: RenewalFrequency.MONTHLY,
      intervalCount: 1,
      nextDueDate: new Date("2026-01-01T00:00:00.000Z")
    });

    expect(result.createTransaction).toBe(true);
    expect(isoDate(result.newNextDueDate)).toBe("2026-02-01");
  });

  it("skipRenewalCycle advances the date without creating a transaction", () => {
    const result = calculateSkippedRenewalCycle({
      frequency: RenewalFrequency.WEEKLY,
      intervalCount: 1,
      nextDueDate: new Date("2026-01-01T00:00:00.000Z")
    });

    expect(result.createTransaction).toBe(false);
    expect(isoDate(result.newNextDueDate)).toBe("2026-01-08");
  });
});
