"use server";

import {
  AdjustmentDirection,
  AdjustmentTarget,
  MoneySourceType,
  Prisma,
  QualityRating,
  TransactionType
} from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import {
  transactionCreatedMetadata,
  transactionDeletedMetadata,
  transactionUpdatedMetadata
} from "@/lib/activity";
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

const nullableTextSchema = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  });

const nullableIdSchema = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  });

const maxDecimal18WithScale2 = new Prisma.Decimal("9999999999999999.99");
const positiveDecimalSchema = z
  .union([z.string(), z.instanceof(Prisma.Decimal)])
  .transform((value, context) => {
    const text = typeof value === "string" ? value.trim() : value.toString();
    let amount: Prisma.Decimal;

    try {
      amount = new Prisma.Decimal(text);
    } catch {
      context.addIssue({
        code: "custom",
        message: "Enter a valid decimal amount."
      });
      return z.NEVER;
    }

    if (
      !text ||
      !amount.isFinite() ||
      !amount.greaterThan(0) ||
      amount.decimalPlaces() > 2 ||
      amount.greaterThan(maxDecimal18WithScale2)
    ) {
      context.addIssue({
        code: "custom",
        message: "Amount must be a positive Decimal(18,2) value."
      });
      return z.NEVER;
    }

    return text;
  });

const nullableQualityRatingSchema = z
  .union([z.nativeEnum(QualityRating), z.literal(""), z.null()])
  .optional()
  .transform((value) => (value === "" ? null : value));

const nullableAdjustmentDirectionSchema = z
  .union([z.nativeEnum(AdjustmentDirection), z.literal(""), z.null()])
  .optional()
  .transform((value) => (value === "" ? null : value));

const nullableAdjustmentTargetSchema = z
  .union([z.nativeEnum(AdjustmentTarget), z.literal(""), z.null()])
  .optional()
  .transform((value) => (value === "" ? null : value));

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
  amount: positiveDecimalSchema,
  currency: z.string().trim().min(1).default("VND"),
  title: z.string().trim().min(1),
  description: nullableTextSchema,
  transactionDate: z.coerce.date(),
  categoryId: nullableIdSchema,
  qualityRating: nullableQualityRatingSchema,
  fromMoneySourceId: nullableIdSchema,
  toMoneySourceId: nullableIdSchema,
  adjustedMoneySourceId: nullableIdSchema,
  adjustmentDirection: nullableAdjustmentDirectionSchema,
  adjustmentTarget: nullableAdjustmentTargetSchema,
  projectId: nullableIdSchema,
  relatedTransactionId: nullableIdSchema,
  countTowardFeeWaiver: optionalBooleanSchema,
  recurringPaymentId: nullableIdSchema,
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

function nullableFormValue(formData: FormData, key: string) {
  if (!formData.has(key)) {
    return undefined;
  }

  const value = formData.get(key);
  return typeof value === "string" && value.trim() === "" ? null : value;
}

function parseTransactionInput(data: TransactionInput | FormData) {
  if (data instanceof FormData) {
    return transactionSchema.safeParse({
      type: formValue(data, "type"),
      amount: formValue(data, "amount"),
      currency: formValue(data, "currency") || "VND",
      title: formValue(data, "title"),
      description: nullableFormValue(data, "description"),
      transactionDate: formValue(data, "transactionDate"),
      categoryId: nullableFormValue(data, "categoryId"),
      qualityRating: nullableFormValue(data, "qualityRating"),
      fromMoneySourceId: nullableFormValue(data, "fromMoneySourceId"),
      toMoneySourceId: nullableFormValue(data, "toMoneySourceId"),
      adjustedMoneySourceId: nullableFormValue(
        data,
        "adjustedMoneySourceId"
      ),
      adjustmentDirection: nullableFormValue(data, "adjustmentDirection"),
      adjustmentTarget: nullableFormValue(data, "adjustmentTarget"),
      projectId: nullableFormValue(data, "projectId"),
      relatedTransactionId: nullableFormValue(data, "relatedTransactionId"),
      countTowardFeeWaiver: formValue(data, "countTowardFeeWaiver"),
      recurringPaymentId: nullableFormValue(data, "recurringPaymentId"),
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
      description: nullableFormValue(data, "description"),
      transactionDate: formValue(data, "transactionDate"),
      categoryId: nullableFormValue(data, "categoryId"),
      qualityRating: nullableFormValue(data, "qualityRating"),
      fromMoneySourceId: nullableFormValue(data, "fromMoneySourceId"),
      toMoneySourceId: nullableFormValue(data, "toMoneySourceId"),
      adjustedMoneySourceId: nullableFormValue(
        data,
        "adjustedMoneySourceId"
      ),
      adjustmentDirection: nullableFormValue(data, "adjustmentDirection"),
      adjustmentTarget: nullableFormValue(data, "adjustmentTarget"),
      projectId: nullableFormValue(data, "projectId"),
      relatedTransactionId: nullableFormValue(data, "relatedTransactionId"),
      countTowardFeeWaiver: formValue(data, "countTowardFeeWaiver"),
      recurringPaymentId: nullableFormValue(data, "recurringPaymentId"),
      isInstallmentRelated: data.has("isInstallmentRelated")
        ? data.get("isInstallmentRelated") === "on"
        : undefined
    });
  }

  return transactionUpdateSchema.safeParse(data);
}

type NullableTransactionField =
  | "categoryId"
  | "qualityRating"
  | "fromMoneySourceId"
  | "toMoneySourceId"
  | "adjustedMoneySourceId"
  | "adjustmentDirection"
  | "adjustmentTarget"
  | "projectId"
  | "relatedTransactionId"
  | "recurringPaymentId";

function nullableTransactionValue<
  T extends TransactionData | TransactionUpdateData
>(data: T, field: NullableTransactionField) {
  return data[field] ?? null;
}

function cleanNullableRelations<
  T extends TransactionData | TransactionUpdateData
>(data: T) {
  return {
    ...data,
    categoryId: nullableTransactionValue(data, "categoryId"),
    qualityRating: nullableTransactionValue(data, "qualityRating"),
    fromMoneySourceId: nullableTransactionValue(data, "fromMoneySourceId"),
    toMoneySourceId: nullableTransactionValue(data, "toMoneySourceId"),
    adjustedMoneySourceId: nullableTransactionValue(
      data,
      "adjustedMoneySourceId"
    ),
    adjustmentDirection: nullableTransactionValue(
      data,
      "adjustmentDirection"
    ),
    adjustmentTarget: nullableTransactionValue(data, "adjustmentTarget"),
    projectId: nullableTransactionValue(data, "projectId"),
    relatedTransactionId: nullableTransactionValue(
      data,
      "relatedTransactionId"
    ),
    recurringPaymentId: nullableTransactionValue(data, "recurringPaymentId")
  };
}

async function verifyTransactionOwnership(
  db: Prisma.TransactionClient | typeof prisma,
  id: string,
  userId: string
) {
  const transaction = await db.transaction.findFirst({
    where: { id, userId }
  });

  if (!transaction) {
    throw new Error("Transaction not found.");
  }

  return transaction;
}

async function verifyOptionalRecord(
  db: Prisma.TransactionClient | typeof prisma,
  model: "financialProject" | "recurringPayment",
  id: string | null | undefined,
  userId: string
) {
  if (!id) {
    return;
  }

  const record =
    model === "financialProject"
      ? await db.financialProject.findFirst({
          where: { id, userId },
          select: { id: true }
        })
      : await db.recurringPayment.findFirst({
          where: { id, userId },
          select: { id: true }
        });

  if (!record) {
    throw new Error("Referenced record not found.");
  }
}

async function getOwnedCategory(
  db: Prisma.TransactionClient | typeof prisma,
  id: string | null | undefined,
  userId: string
) {
  if (!id) {
    return null;
  }

  const category = await db.category.findFirst({
    where: { id, userId },
    select: { id: true, defaultCountTowardFeeWaiver: true }
  });

  if (!category) {
    throw new Error("Referenced record not found.");
  }

  return category;
}

async function verifyRelatedExpense(
  db: Prisma.TransactionClient | typeof prisma,
  id: string | null | undefined,
  userId: string
) {
  if (!id) {
    return;
  }

  const expense = await db.transaction.findFirst({
    where: { id, userId, type: TransactionType.EXPENSE },
    select: { id: true }
  });

  if (!expense) {
    throw new Error("Referenced record not found.");
  }
}

async function hasOwnedLinkedRefund(
  db: Prisma.TransactionClient | typeof prisma,
  id: string,
  userId: string
) {
  const linkedRefundCount = await db.transaction.count({
    where: {
      userId,
      type: TransactionType.REFUND,
      relatedTransactionId: id
    }
  });

  return linkedRefundCount > 0;
}

async function getOwnedMoneySources(
  db: Prisma.TransactionClient | typeof prisma,
  ids: string[],
  userId: string
) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));

  if (uniqueIds.length === 0) {
    return [];
  }

  const moneySources = await db.moneySource.findMany({
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
  db: Prisma.TransactionClient | typeof prisma,
  data: TransactionData | TransactionUpdateData,
  userId: string
) {
  const [category] = await Promise.all([
    getOwnedCategory(db, data.categoryId, userId),
    verifyOptionalRecord(db, "financialProject", data.projectId, userId),
    verifyRelatedExpense(db, data.relatedTransactionId, userId),
    verifyOptionalRecord(db, "recurringPayment", data.recurringPaymentId, userId)
  ]);

  const moneySources = await getOwnedMoneySources(
    db,
    [
      data.fromMoneySourceId,
      data.toMoneySourceId,
      data.adjustedMoneySourceId
    ].filter((id): id is string => Boolean(id)),
    userId
  );

  return { category, moneySources };
}

async function logActivity(
  db: Prisma.TransactionClient,
  userId: string,
  action:
    | "TRANSACTION_CREATED"
    | "TRANSACTION_UPDATED"
    | "TRANSACTION_DELETED",
  entityId: string,
  metadata?: Prisma.InputJsonObject
) {
  await db.activityLog.create({
    data: {
      userId,
      action,
      entityType: "Transaction",
      entityId,
      metadata
    }
  });
}

function validateCompleteTransaction(
  data: TransactionData,
  moneySources: Array<{ id: string; type: MoneySourceType }> = []
) {
  const adjustedMoneySourceType = moneySources.find(
    (source) => source.id === data.adjustedMoneySourceId
  )?.type;

  return validateTransactionFields({
    amount: data.amount,
    type: data.type,
    fromMoneySourceId: data.fromMoneySourceId,
    toMoneySourceId: data.toMoneySourceId,
    adjustedMoneySourceId: data.adjustedMoneySourceId,
    adjustedMoneySourceType,
    adjustmentDirection: data.adjustmentDirection,
    adjustmentTarget: data.adjustmentTarget,
    qualityRating: data.qualityRating,
    relatedTransactionId: data.relatedTransactionId
  });
}

function normalizeTypeTransition(
  data: TransactionData,
  typeChanged: boolean
): TransactionData {
  if (!typeChanged) {
    return data;
  }

  const normalized = { ...data };

  if (normalized.type === TransactionType.INCOME) {
    normalized.fromMoneySourceId = null;
  } else if (normalized.type === TransactionType.EXPENSE) {
    normalized.toMoneySourceId = null;
  } else if (normalized.type === TransactionType.REFUND) {
    normalized.fromMoneySourceId = null;
  } else if (normalized.type === TransactionType.ADJUSTMENT) {
    normalized.fromMoneySourceId = null;
    normalized.toMoneySourceId = null;
  }

  if (normalized.type !== TransactionType.EXPENSE) {
    normalized.qualityRating = null;
  }

  if (normalized.type !== TransactionType.ADJUSTMENT) {
    normalized.adjustedMoneySourceId = null;
    normalized.adjustmentDirection = null;
    normalized.adjustmentTarget = null;
  }

  if (normalized.type !== TransactionType.REFUND) {
    normalized.relatedTransactionId = null;
  }

  return normalized;
}

function normalizeAdjustmentTarget(
  data: TransactionData,
  moneySources: Array<{ id: string; type: MoneySourceType }>,
  adjustmentTargetWasProvided: boolean
) {
  if (data.type !== TransactionType.ADJUSTMENT) {
    return data;
  }

  const adjustedSource = moneySources.find(
    (source) => source.id === data.adjustedMoneySourceId
  );

  if (adjustedSource?.type === MoneySourceType.CREDIT_CARD) {
    return {
      ...data,
      adjustmentTarget:
        data.adjustmentTarget ?? AdjustmentTarget.CREDIT_CARD_DEBT
    };
  }

  return adjustmentTargetWasProvided && data.adjustmentTarget
    ? data
    : { ...data, adjustmentTarget: null };
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

  const initialValidation = validateCompleteTransaction(parsed.data);

  if (!initialValidation.ok) {
    return { ok: false, error: initialValidation.errors.join(" ") };
  }

  const result = await prisma.$transaction(async (db) => {
    const { category, moneySources } = await verifyReferences(
      db,
      parsed.data,
      user.id
    );
    const validation = validateCompleteTransaction(parsed.data, moneySources);

    if (!validation.ok) {
      return { ok: false as const, error: validation.errors.join(" ") };
    }

    const normalizedData = normalizeAdjustmentTarget(
      parsed.data,
      moneySources,
      parsed.data.adjustmentTarget !== undefined
    );
    const countTowardFeeWaiver =
      normalizedData.type === TransactionType.EXPENSE
        ? (parsed.data.countTowardFeeWaiver ??
          getCountTowardFeeWaiverDefault(
            normalizedData,
            moneySources,
            category
          ))
        : false;

    const transaction = await db.transaction.create({
      data: {
        ...cleanNullableRelations(normalizedData),
        countTowardFeeWaiver,
        userId: user.id
      }
    });

    await logActivity(
      db,
      user.id,
      "TRANSACTION_CREATED",
      transaction.id,
      transactionCreatedMetadata(transaction)
    );
    return { ok: true as const };
  });

  if (!result.ok) {
    return result;
  }
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
  const parsed = parseTransactionUpdateInput(data);

  if (!parsed.success) {
    return { ok: false, error: "Enter a valid transaction." };
  }

  if (parsed.data.relatedTransactionId === id) {
    return { ok: false, error: "A transaction cannot relate to itself." };
  }

  const result = await prisma.$transaction(async (db) => {
    const existingTransaction = await verifyTransactionOwnership(
      db,
      id,
      user.id
    );
    if (
      existingTransaction.type === TransactionType.EXPENSE &&
      parsed.data.type !== undefined &&
      parsed.data.type !== TransactionType.EXPENSE &&
      (await hasOwnedLinkedRefund(db, id, user.id))
    ) {
      return {
        ok: false as const,
        error: "Unlink related refunds before changing this expense type."
      };
    }

    const mergedData = {
    type: parsed.data.type ?? existingTransaction.type,
    amount:
      parsed.data.amount !== undefined
        ? parsed.data.amount
        : existingTransaction.amount.toString(),
    currency: parsed.data.currency ?? existingTransaction.currency,
    title: parsed.data.title ?? existingTransaction.title,
    description:
      parsed.data.description !== undefined
        ? parsed.data.description
        : existingTransaction.description,
    transactionDate:
      parsed.data.transactionDate ?? existingTransaction.transactionDate,
    categoryId:
      parsed.data.categoryId !== undefined
        ? parsed.data.categoryId
        : existingTransaction.categoryId,
    qualityRating:
      parsed.data.qualityRating !== undefined
        ? parsed.data.qualityRating
        : existingTransaction.qualityRating,
    fromMoneySourceId:
      parsed.data.fromMoneySourceId !== undefined
        ? parsed.data.fromMoneySourceId
        : existingTransaction.fromMoneySourceId,
    toMoneySourceId:
      parsed.data.toMoneySourceId !== undefined
        ? parsed.data.toMoneySourceId
        : existingTransaction.toMoneySourceId,
    adjustedMoneySourceId:
      parsed.data.adjustedMoneySourceId !== undefined
        ? parsed.data.adjustedMoneySourceId
        : existingTransaction.adjustedMoneySourceId,
    adjustmentDirection:
      parsed.data.adjustmentDirection !== undefined
        ? parsed.data.adjustmentDirection
        : existingTransaction.adjustmentDirection,
    adjustmentTarget:
      parsed.data.adjustmentTarget !== undefined
        ? parsed.data.adjustmentTarget
        : existingTransaction.adjustmentTarget,
    projectId:
      parsed.data.projectId !== undefined
        ? parsed.data.projectId
        : existingTransaction.projectId,
    relatedTransactionId:
      parsed.data.relatedTransactionId !== undefined
        ? parsed.data.relatedTransactionId
        : existingTransaction.relatedTransactionId,
    countTowardFeeWaiver:
      parsed.data.countTowardFeeWaiver ??
      existingTransaction.countTowardFeeWaiver,
    recurringPaymentId:
      parsed.data.recurringPaymentId !== undefined
        ? parsed.data.recurringPaymentId
        : existingTransaction.recurringPaymentId,
    isInstallmentRelated:
      parsed.data.isInstallmentRelated ?? existingTransaction.isInstallmentRelated
    } satisfies TransactionData;
    const typeChanged =
      parsed.data.type !== undefined &&
      parsed.data.type !== existingTransaction.type;
    const typeNormalizedData = normalizeTypeTransition(mergedData, typeChanged);

    const initialValidation = validateCompleteTransaction(typeNormalizedData);

    if (!initialValidation.ok) {
      return { ok: false as const, error: initialValidation.errors.join(" ") };
    }

    const { category, moneySources } = await verifyReferences(
      db,
      typeNormalizedData,
      user.id
    );
    const normalizedData = normalizeAdjustmentTarget(
      typeNormalizedData,
      moneySources,
      parsed.data.adjustmentTarget !== undefined
    );
    const validation = validateCompleteTransaction(normalizedData, moneySources);

    if (!validation.ok) {
      return { ok: false as const, error: validation.errors.join(" ") };
    }

  const feeWaiverRelevantFieldsChanged =
    typeChanged ||
    (parsed.data.fromMoneySourceId !== undefined &&
      parsed.data.fromMoneySourceId !== existingTransaction.fromMoneySourceId) ||
    (parsed.data.categoryId !== undefined &&
      parsed.data.categoryId !== existingTransaction.categoryId);
  const countTowardFeeWaiver =
    normalizedData.type === TransactionType.EXPENSE
      ? parsed.data.countTowardFeeWaiver !== undefined
        ? parsed.data.countTowardFeeWaiver
        : feeWaiverRelevantFieldsChanged
          ? getCountTowardFeeWaiverDefault(
              normalizedData,
              moneySources,
              category
            )
          : existingTransaction.countTowardFeeWaiver
      : false;

    await db.transaction.updateMany({
      where: { id, userId: user.id },
      data: {
        ...cleanNullableRelations(normalizedData),
        countTowardFeeWaiver
      }
    });
    const transaction = await verifyTransactionOwnership(db, id, user.id);

    await logActivity(
      db,
      user.id,
      "TRANSACTION_UPDATED",
      transaction.id,
      transactionUpdatedMetadata(existingTransaction, transaction)
    );
    return { ok: true as const };
  });

  if (!result.ok) {
    return result;
  }
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
  await prisma.$transaction(async (db) => {
    const transaction = await verifyTransactionOwnership(db, id, user.id);
    await db.transaction.deleteMany({
      where: { id, userId: user.id }
    });

    await logActivity(
      db,
      user.id,
      "TRANSACTION_DELETED",
      id,
      transactionDeletedMetadata(transaction)
    );
  });

  revalidatePath("/transactions");
  return { ok: true };
}

export async function getTransaction(id: string) {
  const user = await requireAuth();
  return verifyTransactionOwnership(prisma, id, user.id);
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
