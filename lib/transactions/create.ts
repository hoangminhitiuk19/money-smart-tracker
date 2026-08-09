import { randomUUID } from "node:crypto";
import {
  AdjustmentDirection,
  AdjustmentTarget,
  MoneySourceType,
  Prisma,
  QualityRating,
  type Transaction,
  TransactionType
} from "@prisma/client";
import { z } from "zod";
import { transactionCreatedMetadata } from "@/lib/activity";
import {
  getCountTowardFeeWaiverDefault,
  validateTransactionFields
} from "@/lib/calc/transactions";

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

export const transactionCreateSchema = z.object({
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

export type TransactionCreateInput = z.input<typeof transactionCreateSchema>;
export type TransactionCreateData = z.infer<typeof transactionCreateSchema>;

export type TransactionCreateIssue = {
  field: keyof TransactionCreateInput | "form";
  message: string;
};

export type OwnedTransactionReferences = {
  categories: Map<
    string,
    {
      defaultCountTowardFeeWaiver: boolean;
      defaultQualityRating?: QualityRating | null;
    }
  >;
  expenses: Set<string>;
  moneySources: Map<string, { type: MoneySourceType }>;
  projects: Set<string>;
  recurringPayments: Set<string>;
};

export type PreparedTransactionCreate = {
  transaction: Omit<
    Prisma.TransactionUncheckedCreateInput,
    "id" | "userId" | "createdAt" | "updatedAt"
  >;
};

export type TransactionCreateResult =
  | { ok: true; transaction: Transaction }
  | { ok: false; issues: TransactionCreateIssue[] };

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

export function parseTransactionCreateInput(
  input: unknown | FormData
):
  | { ok: true; data: TransactionCreateData }
  | { ok: false; issues: TransactionCreateIssue[] } {
  const parsed = transactionCreateSchema.safeParse(
    input instanceof FormData
      ? {
          type: formValue(input, "type"),
          amount: formValue(input, "amount"),
          currency: formValue(input, "currency") || "VND",
          title: formValue(input, "title"),
          description: nullableFormValue(input, "description"),
          transactionDate: formValue(input, "transactionDate"),
          categoryId: nullableFormValue(input, "categoryId"),
          qualityRating: nullableFormValue(input, "qualityRating"),
          fromMoneySourceId: nullableFormValue(input, "fromMoneySourceId"),
          toMoneySourceId: nullableFormValue(input, "toMoneySourceId"),
          adjustedMoneySourceId: nullableFormValue(
            input,
            "adjustedMoneySourceId"
          ),
          adjustmentDirection: nullableFormValue(input, "adjustmentDirection"),
          adjustmentTarget: nullableFormValue(input, "adjustmentTarget"),
          projectId: nullableFormValue(input, "projectId"),
          relatedTransactionId: nullableFormValue(input, "relatedTransactionId"),
          countTowardFeeWaiver: formValue(input, "countTowardFeeWaiver"),
          recurringPaymentId: nullableFormValue(input, "recurringPaymentId"),
          isInstallmentRelated: input.get("isInstallmentRelated") === "on"
        }
      : input
  );

  if (!parsed.success) {
    return {
      ok: false,
      issues: [{ field: "form", message: "Enter a valid transaction." }]
    };
  }

  return { ok: true, data: parsed.data };
}

function uniqueIds(
  inputs: readonly TransactionCreateData[],
  field: keyof Pick<
    TransactionCreateData,
    | "categoryId"
    | "fromMoneySourceId"
    | "toMoneySourceId"
    | "adjustedMoneySourceId"
    | "projectId"
    | "relatedTransactionId"
    | "recurringPaymentId"
  >
) {
  return Array.from(
    new Set(
      inputs
        .map((input) => input[field])
        .filter((id): id is string => Boolean(id))
    )
  );
}

export async function loadOwnedTransactionReferences(
  db: Prisma.TransactionClient,
  userId: string,
  inputs: readonly TransactionCreateData[]
): Promise<OwnedTransactionReferences> {
  const categoryIds = uniqueIds(inputs, "categoryId");
  const moneySourceIds = Array.from(
    new Set([
      ...uniqueIds(inputs, "fromMoneySourceId"),
      ...uniqueIds(inputs, "toMoneySourceId"),
      ...uniqueIds(inputs, "adjustedMoneySourceId")
    ])
  );
  const projectIds = uniqueIds(inputs, "projectId");
  const expenseIds = uniqueIds(inputs, "relatedTransactionId");
  const recurringPaymentIds = uniqueIds(inputs, "recurringPaymentId");

  const [categories, moneySources, projects, expenses, recurringPayments] =
    await Promise.all([
      categoryIds.length
        ? db.category.findMany({
            where: { id: { in: categoryIds }, userId },
            select: {
              id: true,
              defaultCountTowardFeeWaiver: true,
              defaultQualityRating: true
            }
          })
        : [],
      moneySourceIds.length
        ? db.moneySource.findMany({
            where: { id: { in: moneySourceIds }, userId },
            select: { id: true, type: true }
          })
        : [],
      projectIds.length
        ? db.financialProject.findMany({
            where: { id: { in: projectIds }, userId },
            select: { id: true }
          })
        : [],
      expenseIds.length
        ? db.transaction.findMany({
            where: {
              id: { in: expenseIds },
              userId,
              type: TransactionType.EXPENSE
            },
            select: { id: true }
          })
        : [],
      recurringPaymentIds.length
        ? db.recurringPayment.findMany({
            where: { id: { in: recurringPaymentIds }, userId },
            select: { id: true }
          })
        : []
    ]);

  return {
    categories: new Map(
      categories.map((category) => [
        category.id,
        {
          defaultCountTowardFeeWaiver:
            category.defaultCountTowardFeeWaiver,
          defaultQualityRating: category.defaultQualityRating
        }
      ])
    ),
    expenses: new Set(expenses.map((expense) => expense.id)),
    moneySources: new Map(
      moneySources.map((moneySource) => [
        moneySource.id,
        { type: moneySource.type }
      ])
    ),
    projects: new Set(projects.map((project) => project.id)),
    recurringPayments: new Set(
      recurringPayments.map((recurringPayment) => recurringPayment.id)
    )
  };
}

function referenceIssues(
  data: TransactionCreateData,
  references: OwnedTransactionReferences
): TransactionCreateIssue[] {
  const issues: TransactionCreateIssue[] = [];

  if (data.categoryId && !references.categories.has(data.categoryId)) {
    issues.push({ field: "categoryId", message: "Referenced record not found." });
  }
  if (data.fromMoneySourceId && !references.moneySources.has(data.fromMoneySourceId)) {
    issues.push({
      field: "fromMoneySourceId",
      message: "Referenced money source not found."
    });
  }
  if (data.toMoneySourceId && !references.moneySources.has(data.toMoneySourceId)) {
    issues.push({
      field: "toMoneySourceId",
      message: "Referenced money source not found."
    });
  }
  if (
    data.adjustedMoneySourceId &&
    !references.moneySources.has(data.adjustedMoneySourceId)
  ) {
    issues.push({
      field: "adjustedMoneySourceId",
      message: "Referenced money source not found."
    });
  }
  if (data.projectId && !references.projects.has(data.projectId)) {
    issues.push({ field: "projectId", message: "Referenced record not found." });
  }
  if (data.relatedTransactionId && !references.expenses.has(data.relatedTransactionId)) {
    issues.push({
      field: "relatedTransactionId",
      message: "Referenced record not found."
    });
  }
  if (
    data.recurringPaymentId &&
    !references.recurringPayments.has(data.recurringPaymentId)
  ) {
    issues.push({
      field: "recurringPaymentId",
      message: "Referenced record not found."
    });
  }

  return issues;
}

function cleanNullableRelations(data: TransactionCreateData) {
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

export function prepareTransactionCreate(
  data: TransactionCreateData,
  references: OwnedTransactionReferences
):
  | { ok: true; data: PreparedTransactionCreate }
  | { ok: false; issues: TransactionCreateIssue[] } {
  const initialValidation = validateTransactionFields({
    amount: data.amount,
    type: data.type,
    fromMoneySourceId: data.fromMoneySourceId,
    toMoneySourceId: data.toMoneySourceId,
    adjustedMoneySourceId: data.adjustedMoneySourceId,
    adjustmentDirection: data.adjustmentDirection,
    adjustmentTarget: data.adjustmentTarget,
    qualityRating: data.qualityRating,
    relatedTransactionId: data.relatedTransactionId
  });

  if (!initialValidation.ok) {
    return {
      ok: false,
      issues: initialValidation.errors.map((message) => ({
        field: "form",
        message
      }))
    };
  }

  const ownershipIssues = referenceIssues(data, references);
  if (ownershipIssues.length > 0) {
    return { ok: false, issues: ownershipIssues };
  }

  const adjustedMoneySourceType = data.adjustedMoneySourceId
    ? references.moneySources.get(data.adjustedMoneySourceId)?.type
    : undefined;
  const validation = validateTransactionFields({
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

  if (!validation.ok) {
    return {
      ok: false,
      issues: validation.errors.map((message) => ({ field: "form", message }))
    };
  }

  const adjustmentTarget =
    data.type === TransactionType.ADJUSTMENT &&
    adjustedMoneySourceType === MoneySourceType.CREDIT_CARD
      ? (data.adjustmentTarget ?? AdjustmentTarget.CREDIT_CARD_DEBT)
      : null;
  const normalizedData = { ...data, adjustmentTarget };
  const countTowardFeeWaiver =
    normalizedData.type === TransactionType.EXPENSE
      ? (data.countTowardFeeWaiver ??
        getCountTowardFeeWaiverDefault(
          normalizedData,
          Array.from(references.moneySources, ([id, source]) => ({
            id,
            type: source.type
          })),
          data.categoryId ? references.categories.get(data.categoryId) : undefined
        ))
      : false;

  return {
    ok: true,
    data: {
      transaction: {
        ...cleanNullableRelations(normalizedData),
        countTowardFeeWaiver
      }
    }
  };
}

export async function persistPreparedTransaction(
  db: Prisma.TransactionClient,
  userId: string,
  prepared: PreparedTransactionCreate
): Promise<Transaction> {
  const transaction = await db.transaction.create({
    data: { ...prepared.transaction, userId }
  });

  await db.activityLog.create({
    data: {
      userId,
      action: "TRANSACTION_CREATED",
      entityType: "Transaction",
      entityId: transaction.id,
      metadata: transactionCreatedMetadata(transaction)
    }
  });

  return transaction;
}

export async function persistPreparedTransactions(
  db: Prisma.TransactionClient,
  userId: string,
  preparedRows: readonly PreparedTransactionCreate[]
): Promise<Transaction[]> {
  if (preparedRows.length === 0) {
    return [];
  }

  const batchCreatedAt = new Date();
  const rows: Prisma.TransactionCreateManyInput[] = preparedRows.map(
    (prepared, index) => ({
      id: randomUUID(),
      userId,
      createdAt: new Date(batchCreatedAt.getTime() + index),
      ...prepared.transaction
    })
  );
  const created = await db.transaction.createManyAndReturn({ data: rows });
  const createdById = new Map(
    created.map((transaction) => [transaction.id, transaction])
  );
  const transactions = rows.map(({ id }) => {
    const transaction = id ? createdById.get(id) : undefined;
    if (!transaction) {
      throw new Error("Bulk transaction persistence invariant failed.");
    }
    return transaction;
  });

  await db.activityLog.createMany({
    data: transactions.map((transaction) => ({
      userId,
      action: "TRANSACTION_CREATED",
      entityType: "Transaction",
      entityId: transaction.id,
      metadata: transactionCreatedMetadata(transaction)
    }))
  });

  return transactions;
}

export async function createOwnedTransaction(
  db: Prisma.TransactionClient,
  userId: string,
  input: unknown | FormData
): Promise<TransactionCreateResult> {
  const parsed = parseTransactionCreateInput(input);
  if (!parsed.ok) {
    return parsed;
  }

  const references = await loadOwnedTransactionReferences(db, userId, [parsed.data]);
  const prepared = prepareTransactionCreate(parsed.data, references);
  if (!prepared.ok) {
    return prepared;
  }

  return {
    ok: true,
    transaction: await persistPreparedTransaction(db, userId, prepared.data)
  };
}
