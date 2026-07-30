"use server";

import { MoneySourceType, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import {
  moneySourceCreatedMetadata,
  moneySourceUpdatedActivity
} from "@/lib/activity";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  checkAuthenticatedMutation,
  RATE_LIMIT_MESSAGE
} from "@/lib/security/rate-limit";
import {
  moneySourceSchema,
  moneySourceUpdateSchema,
  type MoneySourceInput,
  type MoneySourceUpdateInput
} from "@/lib/validation/money-source";

export type MoneySourceActionResult = {
  ok: boolean;
  error?: string;
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

function formCheckboxValue(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function moneySourceFormData(formData: FormData) {
  return {
    name: formValue(formData, "name"),
    type: formValue(formData, "type"),
    providerName: nullableFormValue(formData, "providerName"),
    displayIdentifier: nullableFormValue(formData, "displayIdentifier"),
    currency: formValue(formData, "currency"),
    openingBalance: formValue(formData, "openingBalance"),
    description: nullableFormValue(formData, "description"),
    isActive: formCheckboxValue(formData, "isActive"),
    cardLastFourDigits: nullableFormValue(formData, "cardLastFourDigits"),
    cardNetwork: nullableFormValue(formData, "cardNetwork"),
    openedDate: nullableFormValue(formData, "openedDate"),
    creditLimit: nullableFormValue(formData, "creditLimit"),
    initialOutstandingDebt: formValue(
      formData,
      "initialOutstandingDebt"
    ),
    initialCardCredit: formValue(formData, "initialCardCredit"),
    billingCycleDay: nullableFormValue(formData, "billingCycleDay"),
    paymentDueDay: nullableFormValue(formData, "paymentDueDay"),
    hasAnnualFee: formCheckboxValue(formData, "hasAnnualFee"),
    annualFeeAmount: nullableFormValue(formData, "annualFeeAmount"),
    annualFeeCurrency: formValue(formData, "annualFeeCurrency"),
    annualFeeChargeDate: nullableFormValue(formData, "annualFeeChargeDate"),
    annualFeeFrequency: nullableFormValue(formData, "annualFeeFrequency"),
    firstYearFeeWaived: formCheckboxValue(formData, "firstYearFeeWaived"),
    freeYearsCount: nullableFormValue(formData, "freeYearsCount"),
    feeWaivedUntilDate: nullableFormValue(formData, "feeWaivedUntilDate"),
    annualFeeWaiverEnabled: formCheckboxValue(
      formData,
      "annualFeeWaiverEnabled"
    ),
    annualFeeWaiverSpendTarget: nullableFormValue(
      formData,
      "annualFeeWaiverSpendTarget"
    ),
    annualFeeWaiverPeriod: nullableFormValue(
      formData,
      "annualFeeWaiverPeriod"
    ),
    waiverPeriodStartDate: nullableFormValue(
      formData,
      "waiverPeriodStartDate"
    ),
    waiverPeriodEndDate: nullableFormValue(formData, "waiverPeriodEndDate"),
    annualFeeWaiverNote: nullableFormValue(
      formData,
      "annualFeeWaiverNote"
    )
  };
}

function parseMoneySourceInput(data: MoneySourceInput | FormData) {
  if (data instanceof FormData) {
    return moneySourceSchema.safeParse(moneySourceFormData(data));
  }

  return moneySourceSchema.safeParse(data);
}

function parseMoneySourceUpdateInput(
  data: MoneySourceUpdateInput | FormData
) {
  if (data instanceof FormData) {
    return moneySourceUpdateSchema.safeParse(moneySourceFormData(data));
  }

  return moneySourceUpdateSchema.safeParse(data);
}

const clearedCardConfiguration = {
  cardLastFourDigits: null,
  cardNetwork: null,
  openedDate: null,
  creditLimit: null,
  initialOutstandingDebt: "0",
  initialCardCredit: "0",
  billingCycleDay: null,
  paymentDueDay: null,
  hasAnnualFee: false,
  annualFeeAmount: null,
  annualFeeCurrency: "VND",
  annualFeeChargeDate: null,
  annualFeeFrequency: null,
  firstYearFeeWaived: false,
  freeYearsCount: null,
  feeWaivedUntilDate: null,
  annualFeeWaiverEnabled: false,
  annualFeeWaiverSpendTarget: null,
  annualFeeWaiverPeriod: null,
  waiverPeriodStartDate: null,
  waiverPeriodEndDate: null,
  annualFeeWaiverNote: null
} satisfies Prisma.MoneySourceUpdateManyMutationInput;

async function verifyMoneySourceOwnership(
  db: Prisma.TransactionClient | typeof prisma,
  id: string,
  userId: string
) {
  const moneySource = await db.moneySource.findFirst({
    where: { id, userId }
  });

  if (!moneySource) {
    throw new Error("Money source not found.");
  }

  return moneySource;
}

async function logActivity(
  db: Prisma.TransactionClient,
  userId: string,
  action:
    | "MONEY_SOURCE_CREATED"
    | "MONEY_SOURCE_UPDATED"
    | "CREDIT_CARD_UPDATED"
    | "MONEY_SOURCE_DELETED",
  entityId: string,
  metadata?: Prisma.InputJsonObject
) {
  await db.activityLog.create({
    data: {
      userId,
      action,
      entityType: "MoneySource",
      entityId,
      metadata
    }
  });
}

export async function createMoneySource(
  data: MoneySourceInput | FormData
): Promise<MoneySourceActionResult> {
  const user = await requireAuth();
  const rateLimit = await checkAuthenticatedMutation(user.id);
  if (!rateLimit.allowed) {
    return { ok: false, error: RATE_LIMIT_MESSAGE };
  }
  const parsed = parseMoneySourceInput(data);

  if (!parsed.success) {
    return { ok: false, error: "Enter a valid account or wallet." };
  }

  await prisma.$transaction(async (db) => {
    const moneySource = await db.moneySource.create({
      data: {
        ...parsed.data,
        userId: user.id
      }
    });

    await logActivity(
      db,
      user.id,
      "MONEY_SOURCE_CREATED",
      moneySource.id,
      moneySourceCreatedMetadata(moneySource)
    );
  });

  revalidatePath("/accounts");
  return { ok: true };
}

export async function createMoneySourceFormAction(formData: FormData) {
  await createMoneySource(formData);
}

export async function updateMoneySource(
  id: string,
  data: MoneySourceUpdateInput | FormData
): Promise<MoneySourceActionResult> {
  const user = await requireAuth();
  const rateLimit = await checkAuthenticatedMutation(user.id);
  if (!rateLimit.allowed) {
    return { ok: false, error: RATE_LIMIT_MESSAGE };
  }
  const parsed = parseMoneySourceUpdateInput(data);

  if (!parsed.success) {
    return { ok: false, error: "Enter a valid account or wallet." };
  }

  const result = await prisma.$transaction(async (db) => {
    const existingMoneySource = await verifyMoneySourceOwnership(
      db,
      id,
      user.id
    );
    const updateData =
      parsed.data.type !== undefined &&
      parsed.data.type !== MoneySourceType.CREDIT_CARD
        ? { ...parsed.data, ...clearedCardConfiguration }
        : parsed.data;
    const completeUpdate = moneySourceSchema.safeParse({
      ...existingMoneySource,
      ...updateData
    });

    if (!completeUpdate.success) {
      return { ok: false as const, error: "Enter a valid account or wallet." };
    }

    await db.moneySource.updateMany({
      where: { id, userId: user.id },
      data: updateData
    });
    const moneySource = await verifyMoneySourceOwnership(db, id, user.id);
    const activity = moneySourceUpdatedActivity(
      existingMoneySource,
      moneySource
    );

    await logActivity(
      db,
      user.id,
      activity.action,
      moneySource.id,
      activity.metadata
    );
    return { ok: true as const };
  });

  if (!result.ok) {
    return result;
  }
  revalidatePath("/accounts");
  revalidatePath(`/accounts/${id}`);
  return { ok: true };
}

export async function updateMoneySourceFormAction(
  id: string,
  formData: FormData
) {
  await updateMoneySource(id, formData);
}

export async function toggleMoneySourceActiveFormAction(
  id: string,
  isActive: boolean,
  _formData: FormData
) {
  void _formData;
  await updateMoneySource(id, { isActive });
}

export async function deleteMoneySource(
  id: string
): Promise<MoneySourceActionResult> {
  const user = await requireAuth();
  const rateLimit = await checkAuthenticatedMutation(user.id);
  if (!rateLimit.allowed) {
    return { ok: false, error: RATE_LIMIT_MESSAGE };
  }
  const result = await prisma.$transaction(async (db) => {
    const moneySource = await verifyMoneySourceOwnership(db, id, user.id);
    const transactionCount = await db.transaction.count({
      where: {
        userId: user.id,
        OR: [
          { fromMoneySourceId: id },
          { toMoneySourceId: id },
          { adjustedMoneySourceId: id }
        ]
      }
    });

    if (transactionCount > 0) {
      return {
        ok: false as const,
        error: "This account is used by transactions and cannot be deleted."
      };
    }

    await db.moneySource.deleteMany({
      where: { id, userId: user.id }
    });

    await logActivity(db, user.id, "MONEY_SOURCE_DELETED", id, {
      name: moneySource.name,
      type: moneySource.type
    });
    return { ok: true as const };
  });

  if (!result.ok) {
    return result;
  }
  revalidatePath("/accounts");
  return { ok: true };
}

export async function deleteMoneySourceFormAction(id: string) {
  await deleteMoneySource(id);
}

export async function listMoneySources() {
  const user = await requireAuth();

  return prisma.moneySource.findMany({
    where: { userId: user.id },
    orderBy: [{ isActive: "desc" }, { name: "asc" }]
  });
}

export async function getMoneySource(id: string) {
  const user = await requireAuth();
  return verifyMoneySourceOwnership(prisma, id, user.id);
}
