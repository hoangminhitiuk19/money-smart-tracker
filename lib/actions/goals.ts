"use server";

import { GoalStatus, Prisma } from "@prisma/client";
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

const optionalDateSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return value;
}, z.coerce.date().optional());

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

const goalSchema = z.object({
  name: z.string().trim().min(1),
  targetAmount: positiveDecimalSchema,
  currency: z.string().trim().min(1).default("VND"),
  deadline: optionalDateSchema,
  description: optionalTextSchema,
  status: z.nativeEnum(GoalStatus).default(GoalStatus.ACTIVE)
});

const goalUpdateSchema = goalSchema.partial();

type GoalInput = z.input<typeof goalSchema>;
type GoalUpdateInput = z.input<typeof goalUpdateSchema>;
type GoalData = z.infer<typeof goalSchema>;
type GoalUpdateData = z.infer<typeof goalUpdateSchema>;

export type GoalActionResult = {
  ok: boolean;
  error?: string;
};

function formValue(formData: FormData, key: string) {
  return formData.get(key) ?? undefined;
}

function parseGoalInput(data: GoalInput | FormData) {
  if (data instanceof FormData) {
    return goalSchema.safeParse({
      name: formValue(data, "name"),
      targetAmount: formValue(data, "targetAmount"),
      currency: formValue(data, "currency") || "VND",
      deadline: formValue(data, "deadline"),
      description: formValue(data, "description"),
      status: formValue(data, "status") || GoalStatus.ACTIVE
    });
  }

  return goalSchema.safeParse(data);
}

function parseGoalUpdateInput(data: GoalUpdateInput | FormData) {
  if (data instanceof FormData) {
    return goalUpdateSchema.safeParse({
      name: formValue(data, "name"),
      targetAmount: formValue(data, "targetAmount"),
      currency: formValue(data, "currency"),
      deadline: formValue(data, "deadline"),
      description: formValue(data, "description"),
      status: formValue(data, "status")
    });
  }

  return goalUpdateSchema.safeParse(data);
}

function cleanGoalCreateData(data: GoalData) {
  return {
    ...data,
    deadline: data.deadline ?? null,
    description: data.description ?? null
  };
}

function cleanGoalUpdateData(data: GoalUpdateData) {
  return {
    ...data,
    deadline: "deadline" in data ? data.deadline ?? null : undefined,
    description: "description" in data ? data.description ?? null : undefined
  };
}

async function verifyGoalOwnership(
  db: Prisma.TransactionClient,
  id: string,
  userId: string
) {
  const goal = await db.savingGoal.findFirst({
    where: { id, userId }
  });

  if (!goal) {
    throw new Error("Saving goal not found.");
  }

  return goal;
}

async function logActivity(
  db: Prisma.TransactionClient,
  userId: string,
  action: "GOAL_CREATED" | "GOAL_UPDATED" | "GOAL_DELETED",
  entityId: string,
  metadata?: Prisma.InputJsonObject
) {
  await db.activityLog.create({
    data: {
      userId,
      action,
      entityType: "SavingGoal",
      entityId,
      metadata
    }
  });
}

export async function createGoal(
  data: GoalInput | FormData
): Promise<GoalActionResult> {
  const user = await requireAuth();
  const rateLimit = await checkAuthenticatedMutation(user.id);
  if (!rateLimit.allowed) {
    return { ok: false, error: RATE_LIMIT_MESSAGE };
  }
  const parsed = parseGoalInput(data);

  if (!parsed.success) {
    return { ok: false, error: "Enter a valid saving goal." };
  }

  await prisma.$transaction(async (tx) => {
    const goal = await tx.savingGoal.create({
      data: {
        ...cleanGoalCreateData(parsed.data),
        userId: user.id
      },
      select: { id: true, name: true, status: true, targetAmount: true }
    });

    await logActivity(tx, user.id, "GOAL_CREATED", goal.id, {
      name: goal.name,
      status: goal.status,
      targetAmount: goal.targetAmount.toString()
    });
  });

  revalidatePath("/goals");
  return { ok: true };
}

export async function createGoalFormAction(formData: FormData) {
  await createGoal(formData);
}

export async function updateGoal(
  id: string,
  data: GoalUpdateInput | FormData
): Promise<GoalActionResult> {
  const user = await requireAuth();
  const rateLimit = await checkAuthenticatedMutation(user.id);
  if (!rateLimit.allowed) {
    return { ok: false, error: RATE_LIMIT_MESSAGE };
  }
  const parsed = parseGoalUpdateInput(data);

  if (!parsed.success) {
    return { ok: false, error: "Enter a valid saving goal." };
  }

  await prisma.$transaction(async (tx) => {
    await verifyGoalOwnership(tx, id, user.id);
    await tx.savingGoal.updateMany({
      where: { id, userId: user.id },
      data: cleanGoalUpdateData(parsed.data)
    });
    const goal = await verifyGoalOwnership(tx, id, user.id);

    await logActivity(tx, user.id, "GOAL_UPDATED", goal.id, {
      name: goal.name,
      status: goal.status,
      targetAmount: goal.targetAmount.toString()
    });
  });

  revalidatePath("/goals");
  revalidatePath(`/goals/${id}`);
  return { ok: true };
}

export async function updateGoalFormAction(id: string, formData: FormData) {
  await updateGoal(id, formData);
}

export async function deleteGoal(id: string): Promise<GoalActionResult> {
  const user = await requireAuth();
  const rateLimit = await checkAuthenticatedMutation(user.id);
  if (!rateLimit.allowed) {
    return { ok: false, error: RATE_LIMIT_MESSAGE };
  }
  await prisma.$transaction(async (tx) => {
    const goal = await verifyGoalOwnership(tx, id, user.id);
    await tx.savingGoal.deleteMany({
      where: { id, userId: user.id }
    });

    await logActivity(tx, user.id, "GOAL_DELETED", id, {
      name: goal.name,
      status: goal.status
    });
  });

  revalidatePath("/goals");
  return { ok: true };
}

export async function deleteGoalFormAction(id: string) {
  await deleteGoal(id);
}

export async function listGoals() {
  const user = await requireAuth();

  return prisma.savingGoal.findMany({
    where: { userId: user.id },
    orderBy: [{ status: "asc" }, { deadline: "asc" }, { name: "asc" }],
    include: {
      goalContributions: true
    }
  });
}

export async function getGoal(id: string) {
  const user = await requireAuth();
  return verifyGoalOwnership(prisma, id, user.id);
}
