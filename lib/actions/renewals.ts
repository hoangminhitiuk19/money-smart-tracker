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
  calculateSkippedRenewalCycle
} from "@/lib/calc/renewals";
import { validateTransactionFields } from "@/lib/calc/transactions";
import { prisma } from "@/lib/prisma";

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

const renewalSchema = z.object({
  fromMoneySourceId: optionalIdSchema,
  toMoneySourceId: optionalIdSchema,
  categoryId: optionalIdSchema,
  projectId: optionalIdSchema,
  title: z.string().trim().min(1),
  description: optionalTextSchema,
  amount: z.coerce.number().positive(),
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

async function verifyRenewalOwnership(id: string, userId: string) {
  const renewal = await prisma.recurringPayment.findFirst({
    where: { id, userId }
  });

  if (!renewal) {
    throw new Error("Renewal not found.");
  }

  return renewal;
}

async function verifyOptionalRecord(
  model: "category" | "financialProject",
  id: string | undefined,
  userId: string
) {
  if (!id) {
    return;
  }

  const record =
    model === "category"
      ? await prisma.category.findFirst({
          where: { id, userId },
          select: { id: true }
        })
      : await prisma.financialProject.findFirst({
          where: { id, userId },
          select: { id: true }
        });

  if (!record) {
    throw new Error("Referenced record not found.");
  }
}

async function verifyMoneySources(ids: Array<string | undefined>, userId: string) {
  const uniqueIds = Array.from(new Set(ids.filter((id): id is string => Boolean(id))));

  if (uniqueIds.length === 0) {
    return;
  }

  const moneySources = await prisma.moneySource.findMany({
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
  data: RenewalData | RenewalUpdateData,
  userId: string
) {
  await Promise.all([
    verifyOptionalRecord("category", data.categoryId, userId),
    verifyOptionalRecord("financialProject", data.projectId, userId),
    verifyMoneySources([data.fromMoneySourceId, data.toMoneySourceId], userId)
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
  const parsed = parseRenewalInput(data);

  if (!parsed.success) {
    return { ok: false, error: "Enter a valid renewal." };
  }

  const validation = validateRenewalTransactionShape(parsed.data);

  if (!validation.ok) {
    return { ok: false, error: validation.errors.join(" ") };
  }

  try {
    await verifyReferences(parsed.data, user.id);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Referenced record not found."
    };
  }

  const renewal = await prisma.recurringPayment.create({
    data: {
      ...cleanRenewalData(parsed.data),
      userId: user.id
    },
    select: { id: true, title: true, amount: true, status: true }
  });

  await logActivity(user.id, "RENEWAL_CREATED", renewal.id, {
    title: renewal.title,
    amount: renewal.amount.toString(),
    status: renewal.status
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
  const existingRenewal = await verifyRenewalOwnership(id, user.id);
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
        : Number(existingRenewal.amount),
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
    await verifyReferences(mergedData, user.id);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Referenced record not found."
    };
  }

  await prisma.recurringPayment.updateMany({
    where: { id, userId: user.id },
    data: cleanRenewalData(mergedData),
  });
  const renewal = await verifyRenewalOwnership(id, user.id);

  await logActivity(user.id, "RENEWAL_UPDATED", renewal.id, {
    title: renewal.title,
    amount: renewal.amount.toString(),
    status: renewal.status
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
  today.setHours(0, 0, 0, 0);

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

  return activeRenewals.filter((renewal) => {
    const reminderDate = new Date(today);
    reminderDate.setDate(reminderDate.getDate() + renewal.reminderDaysBefore);
    return renewal.nextDueDate <= reminderDate;
  });
}

export async function markRenewalAsPaid(id: string) {
  const user = await requireAuth();
  const renewal = await verifyRenewalOwnership(id, user.id);
  const validation = validateTransactionFields({
    amount: Number(renewal.amount),
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
  const today = new Date();

  const transaction = await prisma.$transaction(async (db) => {
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

    await db.recurringPayment.updateMany({
      where: { id: renewal.id, userId: user.id },
      data: {
        nextDueDate: cycle.newNextDueDate,
        lastGeneratedDate: today
      }
    });

    await logActivity(
      user.id,
      "RENEWAL_MARKED_PAID",
      renewal.id,
      {
        title: renewal.title,
        transactionId: createdTransaction.id,
        nextDueDate: cycle.newNextDueDate.toISOString()
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
  const renewal = await verifyRenewalOwnership(id, user.id);
  const cycle = calculateSkippedRenewalCycle({
    frequency: renewal.frequency,
    intervalCount: renewal.intervalCount,
    nextDueDate: renewal.nextDueDate
  });

  await prisma.recurringPayment.updateMany({
    where: { id, userId: user.id },
    data: { nextDueDate: cycle.newNextDueDate }
  });

  await logActivity(user.id, "RENEWAL_SKIPPED", id, {
    title: renewal.title,
    nextDueDate: cycle.newNextDueDate.toISOString()
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
  const renewal = await verifyRenewalOwnership(id, user.id);

  await prisma.recurringPayment.updateMany({
    where: { id, userId: user.id },
    data: { status }
  });

  await logActivity(user.id, action, id, {
    title: renewal.title,
    status
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
  const renewal = await verifyRenewalOwnership(id, user.id);

  await prisma.recurringPayment.deleteMany({
    where: { id, userId: user.id }
  });

  await logActivity(user.id, "RENEWAL_DELETED", id, {
    title: renewal.title,
    amount: renewal.amount.toString()
  });

  revalidatePath("/renewals");
  return { ok: true };
}

export async function deleteRenewalFormAction(id: string) {
  await deleteRenewal(id);
}

export async function getRenewal(id: string) {
  const user = await requireAuth();
  return verifyRenewalOwnership(id, user.id);
}
