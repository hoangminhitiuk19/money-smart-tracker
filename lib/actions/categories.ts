"use server";

import { CategoryType, Prisma, QualityRating } from "@prisma/client";
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

const categorySchema = z.object({
  name: z.string().trim().min(1),
  type: z.nativeEnum(CategoryType),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  icon: optionalTextSchema,
  defaultQualityRating: z
    .nativeEnum(QualityRating)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  defaultCountTowardFeeWaiver: z.coerce.boolean().default(true),
  isDefault: z.coerce.boolean().default(false)
});

type CategoryInput = z.input<typeof categorySchema>;

export type CategoryActionResult = {
  ok: boolean;
  error?: string;
};

function parseCategoryInput(data: CategoryInput | FormData) {
  if (data instanceof FormData) {
    return categorySchema.safeParse({
      name: data.get("name"),
      type: data.get("type"),
      color: data.get("color"),
      icon: data.get("icon"),
      defaultQualityRating: data.get("defaultQualityRating"),
      defaultCountTowardFeeWaiver:
        data.get("defaultCountTowardFeeWaiver") === "on",
      isDefault: data.get("isDefault") === "on"
    });
  }

  return categorySchema.safeParse(data);
}

async function verifyCategoryOwnership(
  db: Prisma.TransactionClient | typeof prisma,
  id: string,
  userId: string
) {
  const category = await db.category.findFirst({
    where: { id, userId }
  });

  if (!category) {
    throw new Error("Category not found.");
  }

  return category;
}

async function logActivity(
  db: Prisma.TransactionClient,
  userId: string,
  action: "CATEGORY_CREATED" | "CATEGORY_UPDATED" | "CATEGORY_DELETED",
  entityId: string,
  metadata?: Prisma.InputJsonObject
) {
  await db.activityLog.create({
    data: {
      userId,
      action,
      entityType: "Category",
      entityId,
      metadata
    }
  });
}

export async function createCategory(
  data: CategoryInput | FormData
): Promise<CategoryActionResult> {
  const user = await requireAuth();
  const rateLimit = await checkAuthenticatedMutation(user.id);
  if (!rateLimit.allowed) {
    return { ok: false, error: RATE_LIMIT_MESSAGE };
  }
  const parsed = parseCategoryInput(data);

  if (!parsed.success) {
    return { ok: false, error: "Enter a valid category." };
  }

  await prisma.$transaction(async (db) => {
    const category = await db.category.create({
      data: {
        ...parsed.data,
        userId: user.id
      },
      select: { id: true, name: true, type: true }
    });

    await logActivity(db, user.id, "CATEGORY_CREATED", category.id, {
      name: category.name,
      type: category.type
    });
  });

  revalidatePath("/categories");
  return { ok: true };
}

export async function createCategoryFormAction(formData: FormData) {
  await createCategory(formData);
}

export async function updateCategory(
  id: string,
  data: CategoryInput | FormData
): Promise<CategoryActionResult> {
  const user = await requireAuth();
  const rateLimit = await checkAuthenticatedMutation(user.id);
  if (!rateLimit.allowed) {
    return { ok: false, error: RATE_LIMIT_MESSAGE };
  }
  const parsed = parseCategoryInput(data);

  if (!parsed.success) {
    return { ok: false, error: "Enter a valid category." };
  }

  await prisma.$transaction(async (db) => {
    await verifyCategoryOwnership(db, id, user.id);
    await db.category.updateMany({
      where: { id, userId: user.id },
      data: parsed.data
    });
    const category = await verifyCategoryOwnership(db, id, user.id);

    await logActivity(db, user.id, "CATEGORY_UPDATED", category.id, {
      name: category.name,
      type: category.type
    });
  });

  revalidatePath("/categories");
  return { ok: true };
}

export async function updateCategoryFormAction(id: string, formData: FormData) {
  await updateCategory(id, formData);
}

export async function deleteCategory(
  id: string
): Promise<CategoryActionResult> {
  const user = await requireAuth();
  const rateLimit = await checkAuthenticatedMutation(user.id);
  if (!rateLimit.allowed) {
    return { ok: false, error: RATE_LIMIT_MESSAGE };
  }
  const result = await prisma.$transaction(async (db) => {
    const category = await verifyCategoryOwnership(db, id, user.id);
    const transactionCount = await db.transaction.count({
      where: {
        categoryId: id,
        userId: user.id
      }
    });

    if (transactionCount > 0) {
      return {
        ok: false as const,
        error: "This category is used by transactions and cannot be deleted."
      };
    }

    await db.category.deleteMany({
      where: { id, userId: user.id }
    });

    await logActivity(db, user.id, "CATEGORY_DELETED", id, {
      name: category.name,
      type: category.type
    });
    return { ok: true as const };
  });

  if (!result.ok) {
    return result;
  }
  revalidatePath("/categories");
  return { ok: true };
}

export async function deleteCategoryFormAction(id: string) {
  await deleteCategory(id);
}

export async function listCategories() {
  const user = await requireAuth();

  return prisma.category.findMany({
    where: { userId: user.id },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }]
  });
}

export async function getCategory(id: string) {
  const user = await requireAuth();
  return verifyCategoryOwnership(prisma, id, user.id);
}
