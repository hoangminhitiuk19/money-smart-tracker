"use server";

import { MoneySourceType, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
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

const moneySourceSchema = z.object({
  name: z.string().trim().min(1),
  type: z.nativeEnum(MoneySourceType),
  providerName: optionalTextSchema,
  displayIdentifier: optionalTextSchema,
  currency: z.string().trim().min(1).default("VND"),
  openingBalance: z.coerce.number().default(0),
  description: optionalTextSchema,
  isActive: z.coerce.boolean().default(true)
});

const moneySourceUpdateSchema = moneySourceSchema.partial();

type MoneySourceInput = z.input<typeof moneySourceSchema>;
type MoneySourceUpdateInput = z.input<typeof moneySourceUpdateSchema>;

export type MoneySourceActionResult = {
  ok: boolean;
  error?: string;
};

function parseMoneySourceInput(data: MoneySourceInput | FormData) {
  if (data instanceof FormData) {
    return moneySourceSchema.safeParse({
      name: data.get("name"),
      type: data.get("type"),
      providerName: data.get("providerName"),
      displayIdentifier: data.get("displayIdentifier"),
      currency: data.get("currency") || "VND",
      openingBalance: data.get("openingBalance") || 0,
      description: data.get("description"),
      isActive: data.get("isActive") === "on"
    });
  }

  return moneySourceSchema.safeParse(data);
}

function parseMoneySourceUpdateInput(
  data: MoneySourceUpdateInput | FormData
) {
  if (data instanceof FormData) {
    return moneySourceUpdateSchema.safeParse({
      name: data.get("name") || undefined,
      type: data.get("type") || undefined,
      providerName: data.get("providerName") ?? undefined,
      displayIdentifier: data.get("displayIdentifier") ?? undefined,
      currency: data.get("currency") || undefined,
      openingBalance: data.get("openingBalance") || undefined,
      description: data.get("description") ?? undefined,
      isActive: data.has("isActive") ? data.get("isActive") === "on" : undefined
    });
  }

  return moneySourceUpdateSchema.safeParse(data);
}

async function verifyMoneySourceOwnership(id: string, userId: string) {
  const moneySource = await prisma.moneySource.findFirst({
    where: { id, userId }
  });

  if (!moneySource) {
    throw new Error("Money source not found.");
  }

  return moneySource;
}

async function logActivity(
  userId: string,
  action: "MONEY_SOURCE_CREATED" | "MONEY_SOURCE_UPDATED" | "MONEY_SOURCE_DELETED",
  entityId: string,
  metadata?: Prisma.InputJsonObject
) {
  await prisma.activityLog.create({
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

  const moneySource = await prisma.moneySource.create({
    data: {
      ...parsed.data,
      userId: user.id
    },
    select: { id: true, name: true, type: true }
  });

  await logActivity(user.id, "MONEY_SOURCE_CREATED", moneySource.id, {
    name: moneySource.name,
    type: moneySource.type
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

  await verifyMoneySourceOwnership(id, user.id);

  await prisma.moneySource.updateMany({
    where: { id, userId: user.id },
    data: parsed.data,
  });
  const moneySource = await verifyMoneySourceOwnership(id, user.id);

  await logActivity(user.id, "MONEY_SOURCE_UPDATED", moneySource.id, {
    name: moneySource.name,
    type: moneySource.type,
    isActive: moneySource.isActive
  });

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
  const moneySource = await verifyMoneySourceOwnership(id, user.id);

  const transactionCount = await prisma.transaction.count({
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
      ok: false,
      error: "This account is used by transactions and cannot be deleted."
    };
  }

  await prisma.moneySource.deleteMany({
    where: { id, userId: user.id }
  });

  await logActivity(user.id, "MONEY_SOURCE_DELETED", id, {
    name: moneySource.name,
    type: moneySource.type
  });

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
  return verifyMoneySourceOwnership(id, user.id);
}
