"use server";

import {
  Prisma,
  QualityRating,
  RenewalFrequency,
  RenewalStatus,
  TransactionType
} from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import {
  calculatePaidRenewalCycle,
  calculateSkippedRenewalCycle,
  isUpcomingRenewal
} from "@/lib/calc/renewals";
import { validateTransactionFields } from "@/lib/calc/transactions";
import { moneyText } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import {
  checkAuthenticatedMutation,
  RATE_LIMIT_MESSAGE
} from "@/lib/security/rate-limit";

const optionalIdSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined));

const optionalTextSchema = z
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

const optionalDateSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return value;
}, z.coerce.date().optional());

const maxDecimal18WithScale2 = new Prisma.Decimal("9999999999999999.99");
const positiveDecimalSchema = z
  .union([z.string(), z.number(), z.instanceof(Prisma.Decimal)])
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

const renewalSchema = z.object({
  fromMoneySourceId: optionalIdSchema,
  toMoneySourceId: optionalIdSchema,
  categoryId: optionalIdSchema,
  projectId: optionalIdSchema,
  title: z.string().trim().min(1),
  description: optionalTextSchema,
  amount: positiveDecimalSchema,
  currency: z.string().trim().min(1).default("VND"),
  transactionType: z.nativeEnum(TransactionType),
  qualityRating: z
    .nativeEnum(QualityRating)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  countTowardFeeWaiver: optionalBooleanSchema,
  frequency: z.nativeEnum(RenewalFrequency),
  intervalCount: z.coerce.number().int().positive().default(1),
  nextDueDate: z.coerce.date(),
  reminderDaysBefore: z.coerce.number().int().min(0).default(3),
  autoCreateTransaction: optionalBooleanSchema,
  status: z.nativeEnum(RenewalStatus).default(RenewalStatus.ACTIVE),
  lastGeneratedDate: optionalDateSchema
});

const renewalUpdateSchema = renewalSchema.partial();

type RenewalInput = z.input<typeof renewalSchema>;
type RenewalUpdateInput = z.input<typeof renewalUpdateSchema>;
type RenewalData = z.infer<typeof renewalSchema>;
type RenewalUpdateData = z.infer<typeof renewalUpdateSchema>;

export type RenewalActionResult = {
  ok: boolean;
  error?: string;
};

export type RenewalFilters = {
  status?: RenewalStatus;
};

function formValue(formData: FormData, key: string) {
  return formData.get(key) ?? undefined;
}

function formCheckboxValue(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function parseRenewalInput(data: RenewalInput | FormData) {
  if (data instanceof FormData) {
    return renewalSchema.safeParse({
      fromMoneySourceId: formValue(data, "fromMoneySourceId"),
      toMoneySourceId: formValue(data, "toMoneySourceId"),
      categoryId: formValue(data, "categoryId"),
      projectId: formValue(data, "projectId"),
      title: formValue(data, "title"),
      description: formValue(data, "description"),
      amount: formValue(data, "amount"),
      currency: formValue(data, "currency") || "VND",
      transactionType: formValue(data, "transactionType"),
      qualityRating: formValue(data, "qualityRating"),
      countTowardFeeWaiver: formCheckboxValue(data, "countTowardFeeWaiver"),
      frequency: formValue(data, "frequency"),
      intervalCount: formValue(data, "intervalCount") || 1,
      nextDueDate: formValue(data, "nextDueDate"),
      reminderDaysBefore: formValue(data, "reminderDaysBefore") || 3,
      autoCreateTransaction: formCheckboxValue(data, "autoCreateTransaction"),
      status: formValue(data, "status") || RenewalStatus.ACTIVE,
      lastGeneratedDate: formValue(data, "lastGeneratedDate")
    });
  }

  return renewalSchema.safeParse(data);
}

function parseRenewalUpdateInput(data: RenewalUpdateInput | FormData) {
  if (data instanceof FormData) {
    return renewalUpdateSchema.safeParse({
      fromMoneySourceId: formValue(data, "fromMoneySourceId"),
      toMoneySourceId: formValue(data, "toMoneySourceId"),
      categoryId: formValue(data, "categoryId"),
      projectId: formValue(data, "projectId"),
      title: formValue(data, "title"),
      description: formValue(data, "description"),
      amount: formValue(data, "amount"),
      currency: formValue(data, "currency"),
      transactionType: formValue(data, "transactionType"),
      qualityRating: formValue(data, "qualityRating"),
      countTowardFeeWaiver: formCheckboxValue(data, "countTowardFeeWaiver"),
      frequency: formValue(data, "frequency"),
      intervalCount: formValue(data, "intervalCount"),
      nextDueDate: formValue(data, "nextDueDate"),
      reminderDaysBefore: formValue(data, "reminderDaysBefore"),
      autoCreateTransaction: formCheckboxValue(data, "autoCreateTransaction"),
      status: formValue(data, "status"),
      lastGeneratedDate: formValue(data, "lastGeneratedDate")
    });
  }

  return renewalUpdateSchema.safeParse(data);
}

function cleanRenewalData<T extends RenewalData | RenewalUpdateData>(data: T) {
  return {
    ...data,
    fromMoneySourceId: data.fromMoneySourceId ?? null,
    toMoneySourceId: data.toMoneySourceId ?? null,
    categoryId: data.categoryId ?? null,
    projectId: data.projectId ?? null,
    description: data.description ?? null,
    qualityRating: data.qualityRating ?? null,
    countTowardFeeWaiver: data.countTowardFeeWaiver ?? false,
    autoCreateTransaction: data.autoCreateTransaction ?? false,
    lastGeneratedDate: data.lastGeneratedDate ?? null
  };
}

type RenewalDb = Prisma.TransactionClient | typeof prisma;

async function verifyRenewalOwnership(
  db: RenewalDb,
  id: string,
  userId: string
) {
  const renewal = await db.recurringPayment.findFirst({
    where: { id, userId }
  });

  if (!renewal) {
    throw new Error("Renewal not found.");
  }

  return renewal;
}

async function verifyOptionalRecord(
  db: RenewalDb,
  model: "category" | "financialProject",
  id: string | undefined,
  userId: string
) {
  if (!id) {
    return;
  }

  const record =
    model === "category"
      ? await db.category.findFirst({
          where: { id, userId },
          select: { id: true }
        })
      : await db.financialProject.findFirst({
          where: { id, userId },
          select: { id: true }
        });

  if (!record) {
    throw new Error("Referenced record not found.");
  }
}

async function verifyMoneySources(
  db: RenewalDb,
  ids: Array<string | undefined>,
  userId: string
) {
  const uniqueIds = Array.from(new Set(ids.filter((id): id is string => Boolean(id))));

  if (uniqueIds.length === 0) {
    return;
  }

  const moneySources = await db.moneySource.findMany({
    where: {
      id: { in: uniqueIds },
      userId
    },
    select: { id: true }
  });

  if (moneySources.length !== uniqueIds.length) {
    throw new Error("Referenced money source not found.");
  }
}

async function verifyReferences(
  db: RenewalDb,
  data: RenewalData | RenewalUpdateData,
  userId: string
) {
  await Promise.all([
    verifyOptionalRecord(db, "category", data.categoryId, userId),
    verifyOptionalRecord(db, "financialProject", data.projectId, userId),
    verifyMoneySources(
      db,
      [data.fromMoneySourceId, data.toMoneySourceId],
      userId
    )
  ]);
}

function validateRenewalTransactionShape(data: RenewalData) {
  return validateTransactionFields({
    amount: data.amount,
    type: data.transactionType,
    fromMoneySourceId: data.fromMoneySourceId,
    toMoneySourceId: data.toMoneySourceId,
    qualityRating: data.qualityRating
  });
}

function activityValue(value: unknown): Prisma.InputJsonValue | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Prisma.Decimal) {
    return moneyText(value);
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  return String(value);
}

function renewalChangedFields(
  existing: Record<string, unknown>,
  updates: RenewalUpdateData
): Prisma.InputJsonObject {
  const changedFields: Record<string, Prisma.InputJsonValue> = {};

  for (const [field, newValue] of Object.entries(updates)) {
    if (newValue === undefined) {
      continue;
    }

    const oldActivityValue = activityValue(existing[field]);
    const newActivityValue = activityValue(newValue);
    if (
      JSON.stringify(oldActivityValue) !== JSON.stringify(newActivityValue)
    ) {
      changedFields[field] = [oldActivityValue, newActivityValue];
    }
  }

  return changedFields as Prisma.InputJsonObject;
}

async function logActivity(
  userId: string,
  action:
    | "RENEWAL_CREATED"
    | "RENEWAL_UPDATED"
    | "RENEWAL_MARKED_PAID"
    | "RENEWAL_SKIPPED"
    | "RENEWAL_PAUSED"
    | "RENEWAL_RESUMED"
    | "RENEWAL_CANCELLED"
    | "RENEWAL_DELETED",
  entityId: string,
  metadata?: Prisma.InputJsonObject,
  db: Prisma.TransactionClient | typeof prisma = prisma
) {
  await db.activityLog.create({
    data: {
      userId,
      action,
      entityType: "RecurringPayment",
      entityId,
      metadata
    }
  });
}

export async function createRenewal(
  data: RenewalInput | FormData
): Promise<RenewalActionResult> {
  const user = await requireAuth();
  const rateLimit = await checkAuthenticatedMutation(user.id);
  if (!rateLimit.allowed) {
    return { ok: false, error: RATE_LIMIT_MESSAGE };
  }
  const parsed = parseRenewalInput(data);

  if (!parsed.success) {
    return { ok: false, error: "Enter a valid renewal." };
  }

  const validation = validateRenewalTransactionShape(parsed.data);

  if (!validation.ok) {
    return { ok: false, error: validation.errors.join(" ") };
  }

  try {
    await verifyReferences(prisma, parsed.data, user.id);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Referenced record not found."
    };
  }

  await prisma.$transaction(async (db) => {
    const renewal = await db.recurringPayment.create({
      data: {
        ...cleanRenewalData(parsed.data),
        userId: user.id
      },
      select: { id: true, title: true, amount: true, status: true }
    });

    await logActivity(user.id, "RENEWAL_CREATED", renewal.id, {
      title: renewal.title,
      amount: moneyText(renewal.amount),
      status: renewal.status
    }, db);
  });

  revalidatePath("/renewals");
  return { ok: true };
}

export async function createRenewalFormAction(formData: FormData) {
  await createRenewal(formData);
}

export async function updateRenewal(
  id: string,
  data: RenewalUpdateInput | FormData
): Promise<RenewalActionResult> {
  const user = await requireAuth();
  const rateLimit = await checkAuthenticatedMutation(user.id);
  if (!rateLimit.allowed) {
    return { ok: false, error: RATE_LIMIT_MESSAGE };
  }
  const existingRenewal = await verifyRenewalOwnership(prisma, id, user.id);
  const parsed = parseRenewalUpdateInput(data);

  if (!parsed.success) {
    return { ok: false, error: "Enter a valid renewal." };
  }

  const mergedData = {
    fromMoneySourceId:
      parsed.data.fromMoneySourceId !== undefined
        ? parsed.data.fromMoneySourceId
        : existingRenewal.fromMoneySourceId ?? undefined,
    toMoneySourceId:
      parsed.data.toMoneySourceId !== undefined
        ? parsed.data.toMoneySourceId
        : existingRenewal.toMoneySourceId ?? undefined,
    categoryId:
      parsed.data.categoryId !== undefined
        ? parsed.data.categoryId
        : existingRenewal.categoryId ?? undefined,
    projectId:
      parsed.data.projectId !== undefined
        ? parsed.data.projectId
        : existingRenewal.projectId ?? undefined,
    title: parsed.data.title ?? existingRenewal.title,
    description:
      parsed.data.description !== undefined
        ? parsed.data.description
        : existingRenewal.description ?? undefined,
    amount:
      parsed.data.amount !== undefined
        ? parsed.data.amount
        : existingRenewal.amount.toString(),
    currency: parsed.data.currency ?? existingRenewal.currency,
    transactionType:
      parsed.data.transactionType ?? existingRenewal.transactionType,
    qualityRating:
      parsed.data.qualityRating !== undefined
        ? parsed.data.qualityRating
        : existingRenewal.qualityRating ?? undefined,
    countTowardFeeWaiver:
      parsed.data.countTowardFeeWaiver ?? existingRenewal.countTowardFeeWaiver,
    frequency: parsed.data.frequency ?? existingRenewal.frequency,
    intervalCount: parsed.data.intervalCount ?? existingRenewal.intervalCount,
    nextDueDate: parsed.data.nextDueDate ?? existingRenewal.nextDueDate,
    reminderDaysBefore:
      parsed.data.reminderDaysBefore ?? existingRenewal.reminderDaysBefore,
    autoCreateTransaction:
      parsed.data.autoCreateTransaction ?? existingRenewal.autoCreateTransaction,
    status: parsed.data.status ?? existingRenewal.status,
    lastGeneratedDate:
      parsed.data.lastGeneratedDate !== undefined
        ? parsed.data.lastGeneratedDate
        : existingRenewal.lastGeneratedDate ?? undefined
  } satisfies RenewalData;

  const validation = validateRenewalTransactionShape(mergedData);

  if (!validation.ok) {
    return { ok: false, error: validation.errors.join(" ") };
  }

  try {
    await verifyReferences(prisma, mergedData, user.id);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Referenced record not found."
    };
  }

  const changedFields = renewalChangedFields(
    existingRenewal as unknown as Record<string, unknown>,
    parsed.data
  );
  await prisma.$transaction(async (db) => {
    await verifyRenewalOwnership(db, id, user.id);
    await db.recurringPayment.updateMany({
      where: { id, userId: user.id },
      data: cleanRenewalData(mergedData)
    });

    await logActivity(user.id, "RENEWAL_UPDATED", id, {
      renewalId: id,
      changedFields
    }, db);
  });

  revalidatePath("/renewals");
  return { ok: true };
}

export async function updateRenewalFormAction(id: string, formData: FormData) {
  await updateRenewal(id, formData);
}

export async function listRenewals(filter: RenewalFilters = {}) {
  const user = await requireAuth();

  return prisma.recurringPayment.findMany({
    where: {
      userId: user.id,
      status: filter.status
    },
    orderBy: [{ nextDueDate: "asc" }, { title: "asc" }],
    include: {
      category: true,
      fromMoneySource: true,
      toMoneySource: true,
      project: true
    }
  });
}

export async function getUpcomingRenewals() {
  const user = await requireAuth();
  const today = new Date();

  const activeRenewals = await prisma.recurringPayment.findMany({
    where: {
      userId: user.id,
      status: RenewalStatus.ACTIVE
    },
    orderBy: [{ nextDueDate: "asc" }, { title: "asc" }],
    include: {
      category: true,
      fromMoneySource: true,
      toMoneySource: true,
      project: true
    }
  });

  return activeRenewals.filter((renewal) =>
    isUpcomingRenewal(renewal, today)
  );
}

export async function markRenewalAsPaid(id: string) {
  const user = await requireAuth();
  const rateLimit = await checkAuthenticatedMutation(user.id);
  if (!rateLimit.allowed) {
    return { ok: false, error: RATE_LIMIT_MESSAGE };
  }
  const today = new Date();

  const transaction = await prisma.$transaction(async (db) => {
    const renewal = await verifyRenewalOwnership(db, id, user.id);
    if (renewal.status !== RenewalStatus.ACTIVE) {
      throw new Error("Renewal is not active.");
    }

    const validation = validateTransactionFields({
      amount: renewal.amount,
      type: renewal.transactionType,
      fromMoneySourceId: renewal.fromMoneySourceId,
      toMoneySourceId: renewal.toMoneySourceId,
      qualityRating: renewal.qualityRating
    });

    if (!validation.ok) {
      throw new Error(validation.errors.join(" "));
    }

    const cycle = calculatePaidRenewalCycle({
      frequency: renewal.frequency,
      intervalCount: renewal.intervalCount,
      nextDueDate: renewal.nextDueDate
    });
    const claimed = await db.recurringPayment.updateMany({
      where: {
        id: renewal.id,
        userId: user.id,
        status: RenewalStatus.ACTIVE,
        nextDueDate: renewal.nextDueDate
      },
      data: {
        nextDueDate: cycle.newNextDueDate,
        lastGeneratedDate: today
      }
    });
    if (claimed.count !== 1) {
      throw new Error("Renewal changed. Please try again.");
    }

    const createdTransaction = await db.transaction.create({
      data: {
        userId: user.id,
        type: renewal.transactionType,
        amount: renewal.amount,
        currency: renewal.currency,
        title: renewal.title,
        description: renewal.description,
        transactionDate: today,
        categoryId: renewal.categoryId,
        qualityRating: renewal.qualityRating,
        fromMoneySourceId: renewal.fromMoneySourceId,
        toMoneySourceId: renewal.toMoneySourceId,
        projectId: renewal.projectId,
        countTowardFeeWaiver: renewal.countTowardFeeWaiver,
        recurringPaymentId: renewal.id,
        isInstallmentRelated: false
      }
    });

    await logActivity(
      user.id,
      "RENEWAL_MARKED_PAID",
      renewal.id,
      {
        renewalId: renewal.id,
        amount: moneyText(renewal.amount),
        newNextDueDate: cycle.newNextDueDate.toISOString()
      },
      db
    );

    return createdTransaction;
  });

  revalidatePath("/renewals");
  revalidatePath("/transactions");
  return transaction;
}

export async function markRenewalAsPaidFormAction(id: string) {
  await markRenewalAsPaid(id);
}

export async function skipRenewalCycle(id: string): Promise<RenewalActionResult> {
  const user = await requireAuth();
  const rateLimit = await checkAuthenticatedMutation(user.id);
  if (!rateLimit.allowed) {
    return { ok: false, error: RATE_LIMIT_MESSAGE };
  }
  await prisma.$transaction(async (db) => {
    const renewal = await verifyRenewalOwnership(db, id, user.id);
    if (renewal.status !== RenewalStatus.ACTIVE) {
      throw new Error("Renewal is not active.");
    }

    const cycle = calculateSkippedRenewalCycle({
      frequency: renewal.frequency,
      intervalCount: renewal.intervalCount,
      nextDueDate: renewal.nextDueDate
    });
    const claimed = await db.recurringPayment.updateMany({
      where: {
        id,
        userId: user.id,
        status: RenewalStatus.ACTIVE,
        nextDueDate: renewal.nextDueDate
      },
      data: { nextDueDate: cycle.newNextDueDate }
    });
    if (claimed.count !== 1) {
      throw new Error("Renewal changed. Please try again.");
    }

    await logActivity(user.id, "RENEWAL_SKIPPED", id, {
      renewalId: id,
      newNextDueDate: cycle.newNextDueDate.toISOString()
    }, db);
  });

  revalidatePath("/renewals");
  return { ok: true };
}

export async function skipRenewalCycleFormAction(id: string) {
  await skipRenewalCycle(id);
}

async function updateRenewalStatus(
  id: string,
  status: RenewalStatus,
  action:
    | "RENEWAL_PAUSED"
    | "RENEWAL_RESUMED"
    | "RENEWAL_CANCELLED"
): Promise<RenewalActionResult> {
  const user = await requireAuth();
  const rateLimit = await checkAuthenticatedMutation(user.id);
  if (!rateLimit.allowed) {
    return { ok: false, error: RATE_LIMIT_MESSAGE };
  }
  await prisma.$transaction(async (db) => {
    await verifyRenewalOwnership(db, id, user.id);
    await db.recurringPayment.updateMany({
      where: { id, userId: user.id },
      data: { status }
    });

    await logActivity(user.id, action, id, {
      renewalId: id
    }, db);
  });
  revalidatePath("/renewals");
  return { ok: true };
}

export async function pauseRenewal(id: string) {
  return updateRenewalStatus(id, RenewalStatus.PAUSED, "RENEWAL_PAUSED");
}

export async function pauseRenewalFormAction(id: string) {
  await pauseRenewal(id);
}

export async function resumeRenewal(id: string) {
  return updateRenewalStatus(id, RenewalStatus.ACTIVE, "RENEWAL_RESUMED");
}

export async function resumeRenewalFormAction(id: string) {
  await resumeRenewal(id);
}

export async function cancelRenewal(id: string) {
  return updateRenewalStatus(id, RenewalStatus.CANCELLED, "RENEWAL_CANCELLED");
}

export async function cancelRenewalFormAction(id: string) {
  await cancelRenewal(id);
}

export async function deleteRenewal(id: string): Promise<RenewalActionResult> {
  const user = await requireAuth();
  const rateLimit = await checkAuthenticatedMutation(user.id);
  if (!rateLimit.allowed) {
    return { ok: false, error: RATE_LIMIT_MESSAGE };
  }
  await prisma.$transaction(async (db) => {
    const renewal = await verifyRenewalOwnership(db, id, user.id);
    await db.recurringPayment.deleteMany({
      where: { id, userId: user.id }
    });

    await logActivity(user.id, "RENEWAL_DELETED", id, {
      renewalId: id,
      title: renewal.title
    }, db);
  });

  revalidatePath("/renewals");
  return { ok: true };
}

export async function deleteRenewalFormAction(id: string) {
  await deleteRenewal(id);
}

export async function getRenewal(id: string) {
  const user = await requireAuth();
  return verifyRenewalOwnership(prisma, id, user.id);
}
