"use server";

import {
  AdjustmentDirection,
  AdjustmentTarget,
  Prisma,
  QualityRating,
  TransactionType
} from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import {
  getCountTowardFeeWaiverDefault,
  validateTransactionFields
} from "@/lib/calc/transactions";
import { parseTransactionDateRange } from "@/lib/date-range";
import { prisma } from "@/lib/prisma";
import {
  checkAuthenticatedMutation,
  RATE_LIMIT_MESSAGE
} from "@/lib/security/rate-limit";

const optionalTextSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined));

const optionalIdSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined));

const optionalBooleanSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (value === "on" || value === "true" || value === true) {
    return true;
  }

  if (value === "false" || value === false) {
    return false;
  }

  return value;
}, z.boolean().optional());

const transactionSchema = z.object({
  type: z.nativeEnum(TransactionType),
  amount: z.coerce.number().positive(),
  currency: z.string().trim().min(1).default("VND"),
  title: z.string().trim().min(1),
  description: optionalTextSchema,
  transactionDate: z.coerce.date(),
  categoryId: optionalIdSchema,
  qualityRating: z
    .nativeEnum(QualityRating)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  fromMoneySourceId: optionalIdSchema,
  toMoneySourceId: optionalIdSchema,
  adjustedMoneySourceId: optionalIdSchema,
  adjustmentDirection: z
    .nativeEnum(AdjustmentDirection)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  adjustmentTarget: z
    .nativeEnum(AdjustmentTarget)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  projectId: optionalIdSchema,
  relatedTransactionId: optionalIdSchema,
  countTowardFeeWaiver: optionalBooleanSchema,
  recurringPaymentId: optionalIdSchema,
  isInstallmentRelated: z.coerce.boolean().default(false)
});

const transactionUpdateSchema = transactionSchema.partial();

type TransactionInput = z.input<typeof transactionSchema>;
type TransactionUpdateInput = z.input<typeof transactionUpdateSchema>;
type TransactionData = z.infer<typeof transactionSchema>;
type TransactionUpdateData = z.infer<typeof transactionUpdateSchema>;

export type TransactionFormInput = TransactionInput;

export type TransactionActionResult = {
  ok: boolean;
  error?: string;
};

export type TransactionFilters = {
  q?: string;
  type?: TransactionType;
  categoryId?: string;
  moneySourceId?: string;
  projectId?: string;
  qualityRating?: QualityRating;
  startDate?: Date | string;
  endDate?: Date | string;
  query?: string;
  page?: number;
  pageSize?: number;
};

function formValue(formData: FormData, key: string) {
  return formData.get(key) ?? undefined;
}

function parseTransactionInput(data: TransactionInput | FormData) {
  if (data instanceof FormData) {
    return transactionSchema.safeParse({
      type: formValue(data, "type"),
      amount: formValue(data, "amount"),
      currency: formValue(data, "currency") || "VND",
      title: formValue(data, "title"),
      description: formValue(data, "description"),
      transactionDate: formValue(data, "transactionDate"),
      categoryId: formValue(data, "categoryId"),
      qualityRating: formValue(data, "qualityRating"),
      fromMoneySourceId: formValue(data, "fromMoneySourceId"),
      toMoneySourceId: formValue(data, "toMoneySourceId"),
      adjustedMoneySourceId: formValue(data, "adjustedMoneySourceId"),
      adjustmentDirection: formValue(data, "adjustmentDirection"),
      adjustmentTarget: formValue(data, "adjustmentTarget"),
      projectId: formValue(data, "projectId"),
      relatedTransactionId: formValue(data, "relatedTransactionId"),
      countTowardFeeWaiver: formValue(data, "countTowardFeeWaiver"),
      recurringPaymentId: formValue(data, "recurringPaymentId"),
      isInstallmentRelated: data.get("isInstallmentRelated") === "on"
    });
  }

  return transactionSchema.safeParse(data);
}

function parseTransactionUpdateInput(data: TransactionUpdateInput | FormData) {
  if (data instanceof FormData) {
    return transactionUpdateSchema.safeParse({
      type: formValue(data, "type"),
      amount: formValue(data, "amount"),
      currency: formValue(data, "currency"),
      title: formValue(data, "title"),
      description: formValue(data, "description"),
      transactionDate: formValue(data, "transactionDate"),
      categoryId: formValue(data, "categoryId"),
      qualityRating: formValue(data, "qualityRating"),
      fromMoneySourceId: formValue(data, "fromMoneySourceId"),
      toMoneySourceId: formValue(data, "toMoneySourceId"),
      adjustedMoneySourceId: formValue(data, "adjustedMoneySourceId"),
      adjustmentDirection: formValue(data, "adjustmentDirection"),
      adjustmentTarget: formValue(data, "adjustmentTarget"),
      projectId: formValue(data, "projectId"),
      relatedTransactionId: formValue(data, "relatedTransactionId"),
      countTowardFeeWaiver: formValue(data, "countTowardFeeWaiver"),
      recurringPaymentId: formValue(data, "recurringPaymentId"),
      isInstallmentRelated: data.has("isInstallmentRelated")
        ? data.get("isInstallmentRelated") === "on"
        : undefined
    });
  }

  return transactionUpdateSchema.safeParse(data);
}

function cleanNullableRelations<T extends TransactionData | TransactionUpdateData>(
  data: T
) {
  return {
    ...data,
    categoryId: data.categoryId ?? null,
    qualityRating: data.qualityRating ?? null,
    fromMoneySourceId: data.fromMoneySourceId ?? null,
    toMoneySourceId: data.toMoneySourceId ?? null,
    adjustedMoneySourceId: data.adjustedMoneySourceId ?? null,
    adjustmentDirection: data.adjustmentDirection ?? null,
    adjustmentTarget: data.adjustmentTarget ?? null,
    projectId: data.projectId ?? null,
    relatedTransactionId: data.relatedTransactionId ?? null,
    recurringPaymentId: data.recurringPaymentId ?? null
  };
}

async function verifyTransactionOwnership(id: string, userId: string) {
  const transaction = await prisma.transaction.findFirst({
    where: { id, userId }
  });

  if (!transaction) {
    throw new Error("Transaction not found.");
  }

  return transaction;
}

async function verifyOptionalRecord(
  model: "category" | "financialProject" | "transaction" | "recurringPayment",
  id: string | undefined,
  userId: string
) {
  if (!id) {
    return;
  }

  const record =
    model === "category"
      ? await prisma.category.findFirst({ where: { id, userId }, select: { id: true } })
      : model === "financialProject"
        ? await prisma.financialProject.findFirst({
            where: { id, userId },
            select: { id: true }
          })
        : model === "transaction"
          ? await prisma.transaction.findFirst({
              where: { id, userId },
              select: { id: true }
            })
          : await prisma.recurringPayment.findFirst({
              where: { id, userId },
              select: { id: true }
            });

  if (!record) {
    throw new Error("Referenced record not found.");
  }
}

async function getOwnedMoneySources(ids: string[], userId: string) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));

  if (uniqueIds.length === 0) {
    return [];
  }

  const moneySources = await prisma.moneySource.findMany({
    where: {
      id: { in: uniqueIds },
      userId
    },
    select: {
      id: true,
      type: true
    }
  });

  if (moneySources.length !== uniqueIds.length) {
    throw new Error("Referenced money source not found.");
  }

  return moneySources;
}

async function verifyReferences(
  data: TransactionData | TransactionUpdateData,
  userId: string
) {
  await Promise.all([
    verifyOptionalRecord("category", data.categoryId, userId),
    verifyOptionalRecord("financialProject", data.projectId, userId),
    verifyOptionalRecord("transaction", data.relatedTransactionId, userId),
    verifyOptionalRecord("recurringPayment", data.recurringPaymentId, userId)
  ]);

  return getOwnedMoneySources(
    [
      data.fromMoneySourceId,
      data.toMoneySourceId,
      data.adjustedMoneySourceId
    ].filter((id): id is string => Boolean(id)),
    userId
  );
}

async function logActivity(
  userId: string,
  action:
    | "TRANSACTION_CREATED"
    | "TRANSACTION_UPDATED"
    | "TRANSACTION_DELETED",
  entityId: string,
  metadata?: Prisma.InputJsonObject
) {
  await prisma.activityLog.create({
    data: {
      userId,
      action,
      entityType: "Transaction",
      entityId,
      metadata
    }
  });
}

function validateCompleteTransaction(data: TransactionData) {
  return validateTransactionFields({
    amount: data.amount,
    type: data.type,
    fromMoneySourceId: data.fromMoneySourceId,
    toMoneySourceId: data.toMoneySourceId,
    adjustedMoneySourceId: data.adjustedMoneySourceId,
    adjustmentDirection: data.adjustmentDirection,
    qualityRating: data.qualityRating
  });
}

export async function createTransaction(
  data: TransactionInput | FormData
): Promise<TransactionActionResult> {
  const user = await requireAuth();
  const rateLimit = await checkAuthenticatedMutation(user.id);
  if (!rateLimit.allowed) {
    return { ok: false, error: RATE_LIMIT_MESSAGE };
  }
  const parsed = parseTransactionInput(data);

  if (!parsed.success) {
    return { ok: false, error: "Enter a valid transaction." };
  }

  const validation = validateCompleteTransaction(parsed.data);

  if (!validation.ok) {
    return { ok: false, error: validation.errors.join(" ") };
  }

  const moneySources = await verifyReferences(parsed.data, user.id);
  const countTowardFeeWaiver =
    parsed.data.countTowardFeeWaiver ??
    getCountTowardFeeWaiverDefault(parsed.data, moneySources);

  const transaction = await prisma.transaction.create({
    data: {
      ...cleanNullableRelations(parsed.data),
      countTowardFeeWaiver,
      userId: user.id
    },
    select: { id: true, title: true, type: true, amount: true }
  });

  await logActivity(user.id, "TRANSACTION_CREATED", transaction.id, {
    title: transaction.title,
    type: transaction.type,
    amount: transaction.amount.toString()
  });

  revalidatePath("/transactions");
  return { ok: true };
}

export async function updateTransaction(
  id: string,
  data: TransactionUpdateInput | FormData
): Promise<TransactionActionResult> {
  const user = await requireAuth();
  const rateLimit = await checkAuthenticatedMutation(user.id);
  if (!rateLimit.allowed) {
    return { ok: false, error: RATE_LIMIT_MESSAGE };
  }
  const existingTransaction = await verifyTransactionOwnership(id, user.id);
  const parsed = parseTransactionUpdateInput(data);

  if (!parsed.success) {
    return { ok: false, error: "Enter a valid transaction." };
  }

  if (parsed.data.relatedTransactionId === id) {
    return { ok: false, error: "A transaction cannot relate to itself." };
  }

  const mergedData = {
    type: parsed.data.type ?? existingTransaction.type,
    amount:
      parsed.data.amount !== undefined
        ? parsed.data.amount
        : Number(existingTransaction.amount),
    currency: parsed.data.currency ?? existingTransaction.currency,
    title: parsed.data.title ?? existingTransaction.title,
    description:
      parsed.data.description !== undefined
        ? parsed.data.description
        : existingTransaction.description ?? undefined,
    transactionDate:
      parsed.data.transactionDate ?? existingTransaction.transactionDate,
    categoryId:
      parsed.data.categoryId !== undefined
        ? parsed.data.categoryId
        : existingTransaction.categoryId ?? undefined,
    qualityRating:
      parsed.data.qualityRating !== undefined
        ? parsed.data.qualityRating
        : existingTransaction.qualityRating ?? undefined,
    fromMoneySourceId:
      parsed.data.fromMoneySourceId !== undefined
        ? parsed.data.fromMoneySourceId
        : existingTransaction.fromMoneySourceId ?? undefined,
    toMoneySourceId:
      parsed.data.toMoneySourceId !== undefined
        ? parsed.data.toMoneySourceId
        : existingTransaction.toMoneySourceId ?? undefined,
    adjustedMoneySourceId:
      parsed.data.adjustedMoneySourceId !== undefined
        ? parsed.data.adjustedMoneySourceId
        : existingTransaction.adjustedMoneySourceId ?? undefined,
    adjustmentDirection:
      parsed.data.adjustmentDirection !== undefined
        ? parsed.data.adjustmentDirection
        : existingTransaction.adjustmentDirection ?? undefined,
    adjustmentTarget:
      parsed.data.adjustmentTarget !== undefined
        ? parsed.data.adjustmentTarget
        : existingTransaction.adjustmentTarget ?? undefined,
    projectId:
      parsed.data.projectId !== undefined
        ? parsed.data.projectId
        : existingTransaction.projectId ?? undefined,
    relatedTransactionId:
      parsed.data.relatedTransactionId !== undefined
        ? parsed.data.relatedTransactionId
        : existingTransaction.relatedTransactionId ?? undefined,
    countTowardFeeWaiver:
      parsed.data.countTowardFeeWaiver ??
      existingTransaction.countTowardFeeWaiver,
    recurringPaymentId:
      parsed.data.recurringPaymentId !== undefined
        ? parsed.data.recurringPaymentId
        : existingTransaction.recurringPaymentId ?? undefined,
    isInstallmentRelated:
      parsed.data.isInstallmentRelated ?? existingTransaction.isInstallmentRelated
  } satisfies TransactionData;

  const validation = validateCompleteTransaction(mergedData);

  if (!validation.ok) {
    return { ok: false, error: validation.errors.join(" ") };
  }

  const moneySources = await verifyReferences(mergedData, user.id);
  const feeWaiverRelevantFieldsChanged =
    (parsed.data.type !== undefined && parsed.data.type !== existingTransaction.type) ||
    (parsed.data.fromMoneySourceId !== undefined &&
      parsed.data.fromMoneySourceId !== (existingTransaction.fromMoneySourceId ?? undefined));
  const countTowardFeeWaiver =
    parsed.data.countTowardFeeWaiver !== undefined
      ? parsed.data.countTowardFeeWaiver
      : feeWaiverRelevantFieldsChanged
        ? getCountTowardFeeWaiverDefault(mergedData, moneySources)
        : existingTransaction.countTowardFeeWaiver;

  await prisma.transaction.updateMany({
    where: { id, userId: user.id },
    data: {
      ...cleanNullableRelations(mergedData),
      countTowardFeeWaiver
    }
  });
  const transaction = await verifyTransactionOwnership(id, user.id);

  await logActivity(user.id, "TRANSACTION_UPDATED", transaction.id, {
    title: transaction.title,
    type: transaction.type,
    amount: transaction.amount.toString()
  });

  revalidatePath("/transactions");
  revalidatePath(`/transactions/${id}`);
  return { ok: true };
}

export async function deleteTransaction(
  id: string
): Promise<TransactionActionResult> {
  const user = await requireAuth();
  const rateLimit = await checkAuthenticatedMutation(user.id);
  if (!rateLimit.allowed) {
    return { ok: false, error: RATE_LIMIT_MESSAGE };
  }
  const transaction = await verifyTransactionOwnership(id, user.id);

  await prisma.transaction.deleteMany({
    where: { id, userId: user.id }
  });

  await logActivity(user.id, "TRANSACTION_DELETED", id, {
    title: transaction.title,
    type: transaction.type,
    amount: transaction.amount.toString()
  });

  revalidatePath("/transactions");
  return { ok: true };
}

export async function getTransaction(id: string) {
  const user = await requireAuth();
  return verifyTransactionOwnership(id, user.id);
}

function buildTransactionSearchWhere(
  userId: string,
  filters: TransactionFilters
) {
  const where: Prisma.TransactionWhereInput = {
    userId
  };
  const q = filters.q ?? filters.query;

  if (filters.type) {
    where.type = filters.type;
  }

  if (filters.categoryId) {
    where.categoryId = filters.categoryId;
  }

  if (filters.projectId) {
    where.projectId = filters.projectId;
  }

  if (filters.qualityRating) {
    where.qualityRating = filters.qualityRating;
  }

  if (filters.moneySourceId) {
    where.OR = [
      { fromMoneySourceId: filters.moneySourceId },
      { toMoneySourceId: filters.moneySourceId },
      { adjustedMoneySourceId: filters.moneySourceId }
    ];
  }

  if (filters.startDate !== undefined || filters.endDate !== undefined) {
    const dateRange = parseTransactionDateRange(
      filters.startDate,
      filters.endDate
    );

    if (!dateRange.ok) {
      throw new Error(dateRange.error);
    }

    where.transactionDate = dateRange.range;
  }

  if (q) {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : []),
      {
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } }
        ]
      }
    ];
  }

  return where;
}

export async function searchTransactions(filters: TransactionFilters = {}) {
  const user = await requireAuth();
  const page = Math.max(filters.page ?? 1, 1);
  const pageSize = Math.min(Math.max(filters.pageSize ?? 20, 1), 100);
  const where = buildTransactionSearchWhere(user.id, {
    ...filters,
    q: filters.q?.trim(),
    query: filters.query?.trim()
  });

  const [transactions, totalCount] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        category: true,
        fromMoneySource: true,
        toMoneySource: true,
        adjustedMoneySource: true,
        project: true
      }
    }),
    prisma.transaction.count({ where })
  ]);

  return {
    transactions,
    total: totalCount,
    page,
    pageSize
  };
}

export async function listTransactions(filters: TransactionFilters = {}) {
  const result = await searchTransactions(filters);

  return {
    transactions: result.transactions,
    pagination: {
      page: result.page,
      pageSize: result.pageSize,
      totalCount: result.total,
      totalPages: Math.ceil(result.total / result.pageSize)
    }
  };
}
