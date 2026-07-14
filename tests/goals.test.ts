import { ContributionType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  calculateGoalProgress,
  overContributionError,
  validateContributionAgainstTransaction,
  type GoalProgressContribution
} from "@/lib/calc/goals";

function contribution(
  contribution: Partial<GoalProgressContribution>
): GoalProgressContribution {
  return {
    amount: 100,
    type: ContributionType.CONTRIBUTION,
    ...contribution
  };
}

describe("calculateGoalProgress", () => {
  it("calculates progress with contributions only", () => {
    expect(
      calculateGoalProgress(
        [
          contribution({ amount: 300 }),
          contribution({ amount: 200 })
        ],
        1000
      )
    ).toEqual({
      netContributed: 500,
      progressPercent: 50,
      remaining: 500
    });
  });

  it("withdrawals reduce the total", () => {
    expect(
      calculateGoalProgress(
        [
          contribution({ amount: 500 }),
          contribution({ amount: 125, type: ContributionType.WITHDRAWAL })
        ],
        1000
      ).netContributed
    ).toBe(375);
  });

  it("blocks over-contribution when linked to a transaction without manual adjustment", () => {
    expect(
      validateContributionAgainstTransaction({
        amount: 60,
        existingLinkedAmount: 50,
        isManualAdjustment: false,
        transactionAmount: 100,
        transactionId: "tx-1"
      })
    ).toEqual({
      ok: false,
      error: overContributionError
    });
  });

  it("allows over-contribution when manual adjustment is enabled", () => {
    expect(
      validateContributionAgainstTransaction({
        amount: 60,
        existingLinkedAmount: 50,
        isManualAdjustment: true,
        transactionAmount: 100,
        transactionId: "tx-1"
      })
    ).toEqual({ ok: true });
  });

  it("skips over-contribution checks when transactionId is null", () => {
    expect(
      validateContributionAgainstTransaction({
        amount: 500,
        existingLinkedAmount: 500,
        isManualAdjustment: false,
        transactionAmount: 100,
        transactionId: null
      })
    ).toEqual({ ok: true });
  });

  it("calculates remaining", () => {
    expect(
      calculateGoalProgress(
        [
          contribution({ amount: 700 }),
          contribution({ amount: 100, type: ContributionType.WITHDRAWAL })
        ],
        1000
      ).remaining
    ).toBe(400);
  });
});
