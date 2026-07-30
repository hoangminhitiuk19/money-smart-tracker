import { Prisma } from "@prisma/client";

export const transactionReadInclude = {
  category: true,
  fromMoneySource: true,
  toMoneySource: true,
  adjustedMoneySource: true,
  project: true,
  relatedTransaction: true,
  recurringPayment: true
} satisfies Prisma.TransactionInclude;

type TransactionRead = Prisma.TransactionGetPayload<{
  include: typeof transactionReadInclude;
}>;

function ownedRelation<T extends { id: string; userId: string }>(
  relation: T | null,
  userId: string
) {
  return relation?.userId === userId ? relation : null;
}

export function sanitizeTransactionRead(
  transaction: TransactionRead,
  userId: string
) {
  const category = ownedRelation(transaction.category, userId);
  const fromMoneySource = ownedRelation(
    transaction.fromMoneySource,
    userId
  );
  const toMoneySource = ownedRelation(transaction.toMoneySource, userId);
  const adjustedMoneySource = ownedRelation(
    transaction.adjustedMoneySource,
    userId
  );
  const project = ownedRelation(transaction.project, userId);
  const relatedTransaction = ownedRelation(
    transaction.relatedTransaction,
    userId
  );
  const recurringPayment = ownedRelation(
    transaction.recurringPayment,
    userId
  );

  return {
    ...transaction,
    categoryId: category?.id ?? null,
    category,
    fromMoneySourceId: fromMoneySource?.id ?? null,
    fromMoneySource,
    toMoneySourceId: toMoneySource?.id ?? null,
    toMoneySource,
    adjustedMoneySourceId: adjustedMoneySource?.id ?? null,
    adjustedMoneySource,
    projectId: project?.id ?? null,
    project,
    relatedTransactionId: relatedTransaction?.id ?? null,
    relatedTransaction,
    recurringPaymentId: recurringPayment?.id ?? null,
    recurringPayment
  };
}
