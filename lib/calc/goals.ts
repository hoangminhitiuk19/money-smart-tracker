import { ContributionType } from "@prisma/client";

type DecimalLike = {
  toNumber?: () => number;
  toString?: () => string;
};

type GoalAmount = number | string | DecimalLike | null | undefined;

export type GoalProgressContribution = {
  amount: GoalAmount;
  type: ContributionType;
};

export type GoalContributionLimitInput = {
  amount: GoalAmount;
  existingLinkedAmount: GoalAmount;
  isManualAdjustment: boolean;
  transactionAmount?: GoalAmount;
  transactionId?: string | null;
};

export const overContributionError =
  "Total contributions to this transaction exceed its amount. Enable manual adjustment to override.";

function toNumber(value: GoalAmount) {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return Number(value);
  }

  if (value.toNumber) {
    return value.toNumber();
  }

  return Number(value.toString?.() ?? 0);
}

export function calculateGoalProgress(
  contributions: GoalProgressContribution[],
  targetAmount: GoalAmount = 0
) {
  const netContributed = contributions.reduce((total, contribution) => {
    const amount = toNumber(contribution.amount);

    return contribution.type === ContributionType.CONTRIBUTION
      ? total + amount
      : total - amount;
  }, 0);
  const target = toNumber(targetAmount);

  return {
    netContributed,
    progressPercent: target > 0 ? (netContributed / target) * 100 : 0,
    remaining: Math.max(0, target - netContributed)
  };
}

export function validateContributionAgainstTransaction({
  amount,
  existingLinkedAmount,
  isManualAdjustment,
  transactionAmount,
  transactionId
}: GoalContributionLimitInput) {
  if (!transactionId || isManualAdjustment) {
    return { ok: true };
  }

  if (toNumber(existingLinkedAmount) + toNumber(amount) > toNumber(transactionAmount)) {
    return {
      ok: false,
      error: overContributionError
    };
  }

  return { ok: true };
}
