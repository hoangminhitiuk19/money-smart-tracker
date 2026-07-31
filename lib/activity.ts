import {
  type GoalContribution,
  MoneySourceType,
  Prisma,
  type MoneySource,
  type Transaction,
  type TransactionType
} from "@prisma/client";
import { moneyText } from "@/lib/money";
import { prisma } from "@/lib/prisma";

const ACTIVITY_RETENTION_DAYS = 90;
const MAX_ACTIVITY_DELETE_BATCH = 500;
const ACTIVITY_CLEANUP_MINIMUM_INTERVAL_MS = 60 * 60 * 1000;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export function changedFields<T extends Record<string, unknown>>(
  before: T,
  after: T,
  keys: readonly (keyof T)[]
): Record<string, [unknown, unknown]> {
  const changed: Record<string, [unknown, unknown]> = {};

  for (const key of keys) {
    const oldValue = before[key];
    const newValue = after[key];
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      changed[String(key)] = [oldValue, newValue];
    }
  }

  return changed;
}

export function activityRetentionCutoff(now = new Date()) {
  return new Date(
    now.getTime() - ACTIVITY_RETENTION_DAYS * MILLISECONDS_PER_DAY
  );
}

export function retainedActivityWhere(
  userId: string,
  action?: string,
  now = new Date()
): Prisma.ActivityLogWhereInput {
  return {
    userId,
    action: action || undefined,
    createdAt: { gte: activityRetentionCutoff(now) }
  };
}

export async function deleteExpiredActivity(
  db: Prisma.TransactionClient | typeof prisma,
  cutoff: Date,
  limit = MAX_ACTIVITY_DELETE_BATCH
): Promise<number> {
  const batchSize = Math.min(
    MAX_ACTIVITY_DELETE_BATCH,
    Math.max(0, Math.trunc(limit))
  );
  if (batchSize === 0) {
    return 0;
  }

  const expired = await db.activityLog.findMany({
    where: { createdAt: { lt: cutoff } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
    take: batchSize
  });
  if (expired.length === 0) {
    return 0;
  }

  const result = await db.activityLog.deleteMany({
    where: {
      id: { in: expired.map(({ id }) => id) },
      createdAt: { lt: cutoff }
    }
  });
  return result.count;
}

type ActivityRetentionCleanup = (cutoff: Date) => Promise<number>;

export function createActivityRetentionCleanupController(
  cleanup: ActivityRetentionCleanup,
  options: { minimumIntervalMs?: number } = {}
) {
  const minimumIntervalMs = Math.max(
    0,
    options.minimumIntervalMs ?? ACTIVITY_CLEANUP_MINIMUM_INTERVAL_MS
  );
  let inFlight: Promise<boolean> | null = null;
  let nextEligibleAt = 0;

  return (now = new Date()): Promise<boolean> => {
    if (inFlight) {
      return inFlight;
    }

    if (now.getTime() < nextEligibleAt) {
      return Promise.resolve(false);
    }

    nextEligibleAt = now.getTime() + minimumIntervalMs;
    const request = cleanup(activityRetentionCutoff(now))
      .then(() => true)
      .catch(() => false);
    inFlight = request;
    void request.finally(() => {
      if (inFlight === request) {
        inFlight = null;
      }
    });
    return request;
  };
}

export const requestActivityRetentionCleanup =
  createActivityRetentionCleanupController((cutoff) =>
    deleteExpiredActivity(prisma, cutoff)
  );

type TransactionCreatedRecord = Pick<
  Transaction,
  "amount" | "fromMoneySourceId" | "title" | "toMoneySourceId" | "type"
>;

export type TransactionCreatedMetadata = {
  amount: string;
  type: TransactionType;
  title: string;
  fromSourceId: string | null;
  toSourceId: string | null;
};

export function transactionCreatedMetadata(
  transaction: TransactionCreatedRecord
): TransactionCreatedMetadata {
  return {
    amount: moneyText(transaction.amount),
    type: transaction.type,
    title: transaction.title,
    fromSourceId: transaction.fromMoneySourceId,
    toSourceId: transaction.toMoneySourceId
  };
}

const transactionActivityKeys = [
  "type",
  "amount",
  "currency",
  "title",
  "description",
  "transactionDate",
  "categoryId",
  "qualityRating",
  "fromMoneySourceId",
  "toMoneySourceId",
  "adjustedMoneySourceId",
  "adjustmentDirection",
  "adjustmentTarget",
  "projectId",
  "relatedTransactionId",
  "countTowardFeeWaiver",
  "recurringPaymentId",
  "isInstallmentRelated"
] as const;

function transactionActivitySnapshot(transaction: Transaction) {
  return {
    type: transaction.type,
    amount: moneyText(transaction.amount),
    currency: transaction.currency,
    title: transaction.title,
    description: transaction.description,
    transactionDate: transaction.transactionDate.toISOString(),
    categoryId: transaction.categoryId,
    qualityRating: transaction.qualityRating,
    fromMoneySourceId: transaction.fromMoneySourceId,
    toMoneySourceId: transaction.toMoneySourceId,
    adjustedMoneySourceId: transaction.adjustedMoneySourceId,
    adjustmentDirection: transaction.adjustmentDirection,
    adjustmentTarget: transaction.adjustmentTarget,
    projectId: transaction.projectId,
    relatedTransactionId: transaction.relatedTransactionId,
    countTowardFeeWaiver: transaction.countTowardFeeWaiver,
    recurringPaymentId: transaction.recurringPaymentId,
    isInstallmentRelated: transaction.isInstallmentRelated
  };
}

export function transactionUpdatedMetadata(
  before: Transaction,
  after: Transaction
): Prisma.InputJsonObject {
  const beforeSnapshot = transactionActivitySnapshot(before);
  const afterSnapshot = transactionActivitySnapshot(after);
  return {
    changedFields: changedFields(
      beforeSnapshot,
      afterSnapshot,
      transactionActivityKeys
    ) as Prisma.InputJsonObject
  };
}

export function transactionDeletedMetadata(
  transaction: Pick<Transaction, "amount" | "title" | "type">
): Prisma.InputJsonObject {
  return {
    amount: moneyText(transaction.amount),
    type: transaction.type,
    title: transaction.title
  };
}

export function moneySourceCreatedMetadata(
  source: Pick<MoneySource, "name" | "type">
): Prisma.InputJsonObject {
  return {
    name: source.name,
    type: source.type
  };
}

const moneySourceActivityKeys = [
  "name",
  "type",
  "providerName",
  "displayIdentifier",
  "currency",
  "openingBalance",
  "description",
  "isActive",
  "cardLastFourDigits",
  "cardNetwork",
  "openedDate",
  "creditLimit",
  "initialOutstandingDebt",
  "initialCardCredit",
  "billingCycleDay",
  "paymentDueDay",
  "hasAnnualFee",
  "annualFeeAmount",
  "annualFeeCurrency",
  "annualFeeChargeDate",
  "annualFeeFrequency",
  "firstYearFeeWaived",
  "freeYearsCount",
  "feeWaivedUntilDate",
  "annualFeeWaiverEnabled",
  "annualFeeWaiverSpendTarget",
  "annualFeeWaiverPeriod",
  "waiverPeriodStartDate",
  "waiverPeriodEndDate",
  "annualFeeWaiverNote"
] as const;

function moneySourceActivitySnapshot(source: MoneySource) {
  return {
    name: source.name,
    type: source.type,
    providerName: source.providerName,
    displayIdentifier: source.displayIdentifier,
    currency: source.currency,
    openingBalance: moneyText(source.openingBalance),
    description: source.description,
    isActive: source.isActive,
    cardLastFourDigits: source.cardLastFourDigits,
    cardNetwork: source.cardNetwork,
    openedDate: source.openedDate?.toISOString() ?? null,
    creditLimit: source.creditLimit ? moneyText(source.creditLimit) : null,
    initialOutstandingDebt: moneyText(source.initialOutstandingDebt),
    initialCardCredit: moneyText(source.initialCardCredit),
    billingCycleDay: source.billingCycleDay,
    paymentDueDay: source.paymentDueDay,
    hasAnnualFee: source.hasAnnualFee,
    annualFeeAmount: source.annualFeeAmount
      ? moneyText(source.annualFeeAmount)
      : null,
    annualFeeCurrency: source.annualFeeCurrency,
    annualFeeChargeDate: source.annualFeeChargeDate?.toISOString() ?? null,
    annualFeeFrequency: source.annualFeeFrequency,
    firstYearFeeWaived: source.firstYearFeeWaived,
    freeYearsCount: source.freeYearsCount,
    feeWaivedUntilDate: source.feeWaivedUntilDate?.toISOString() ?? null,
    annualFeeWaiverEnabled: source.annualFeeWaiverEnabled,
    annualFeeWaiverSpendTarget: source.annualFeeWaiverSpendTarget
      ? moneyText(source.annualFeeWaiverSpendTarget)
      : null,
    annualFeeWaiverPeriod: source.annualFeeWaiverPeriod,
    waiverPeriodStartDate: source.waiverPeriodStartDate?.toISOString() ?? null,
    waiverPeriodEndDate: source.waiverPeriodEndDate?.toISOString() ?? null,
    annualFeeWaiverNote: source.annualFeeWaiverNote
  };
}

export function moneySourceUpdatedActivity(
  before: MoneySource,
  after: MoneySource
): {
  action: "MONEY_SOURCE_UPDATED" | "CREDIT_CARD_UPDATED";
  metadata: Prisma.InputJsonObject;
} {
  const beforeSnapshot = moneySourceActivitySnapshot(before);
  const afterSnapshot = moneySourceActivitySnapshot(after);
  return {
    action:
      before.type === MoneySourceType.CREDIT_CARD ||
      after.type === MoneySourceType.CREDIT_CARD
        ? "CREDIT_CARD_UPDATED"
        : "MONEY_SOURCE_UPDATED",
    metadata: {
      changedFields: changedFields(
        beforeSnapshot,
        afterSnapshot,
        moneySourceActivityKeys
      ) as Prisma.InputJsonObject
    }
  };
}

export function goalContributionCreatedMetadata(
  contribution: Pick<
    GoalContribution,
    "amount" | "savingGoalId" | "type"
  >
): Prisma.InputJsonObject {
  return {
    goalId: contribution.savingGoalId,
    amount: moneyText(contribution.amount),
    type: contribution.type
  };
}

const goalContributionActivityKeys = [
  "savingGoalId",
  "transactionId",
  "fromMoneySourceId",
  "amount",
  "type",
  "isManualAdjustment",
  "note",
  "contributionDate"
] as const;

function goalContributionActivitySnapshot(contribution: GoalContribution) {
  return {
    savingGoalId: contribution.savingGoalId,
    transactionId: contribution.transactionId,
    fromMoneySourceId: contribution.fromMoneySourceId,
    amount: moneyText(contribution.amount),
    type: contribution.type,
    isManualAdjustment: contribution.isManualAdjustment,
    note: contribution.note,
    contributionDate: contribution.contributionDate.toISOString()
  };
}

export function goalContributionUpdatedMetadata(
  before: GoalContribution,
  after: GoalContribution
): Prisma.InputJsonObject {
  const beforeSnapshot = goalContributionActivitySnapshot(before);
  const afterSnapshot = goalContributionActivitySnapshot(after);
  return {
    changedFields: changedFields(
      beforeSnapshot,
      afterSnapshot,
      goalContributionActivityKeys
    ) as Prisma.InputJsonObject
  };
}
