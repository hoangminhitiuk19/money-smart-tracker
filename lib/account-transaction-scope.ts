import {
  MoneySourceType,
  TransactionType,
  type Prisma
} from "@prisma/client";

type AccountDetailTransactionScopeInput = {
  userId: string;
  sourceId: string;
  sourceType: MoneySourceType;
};

export function buildAccountDetailTransactionScope({
  userId,
  sourceId,
  sourceType
}: AccountDetailTransactionScopeInput): Prisma.TransactionWhereInput {
  const directSourceReferences: Prisma.TransactionWhereInput[] = [
    { fromMoneySourceId: sourceId },
    { toMoneySourceId: sourceId },
    { adjustedMoneySourceId: sourceId }
  ];

  return {
    userId,
    OR:
      sourceType === MoneySourceType.CREDIT_CARD
        ? [
            ...directSourceReferences,
            {
              relatedTransaction: {
                is: {
                  type: TransactionType.EXPENSE,
                  fromMoneySourceId: sourceId
                }
              }
            }
          ]
        : directSourceReferences
  };
}
