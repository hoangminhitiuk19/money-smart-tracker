import { ContributionType } from "@prisma/client";
import { decimal, percent, type DecimalInput } from "@/lib/money";

type GoalAmount = DecimalInput | null | undefined;

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

function amount(value: GoalAmount) {
  return decimal(value ?? 0);
}

export function calculateGoalProgress(
  contributions: GoalProgressContribution[],
  targetAmount: GoalAmount = 0
) {
  const netContributed = contributions.reduce((total, contribution) => {
    const contributionAmount = amount(contribution.amount);

    return contribution.type === ContributionType.CONTRIBUTION
      ? total.plus(contributionAmount)
      : total.minus(contributionAmount);
  }, decimal(0));
  const target = amount(targetAmount);

  return {
    netContributed,
    progressPercent: target.gt(0) ? percent(netContributed, target) : decimal(0),
    remaining: target.minus(netContributed).gt(0)
      ? target.minus(netContributed)
      : decimal(0)
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

  if (
    decimal(existingLinkedAmount ?? 0)
      .plus(decimal(amount ?? 0))
      .gt(decimal(transactionAmount ?? 0))
  ) {
    return {
      ok: false,
      error: overContributionError
    };
  }

  return { ok: true };
}
