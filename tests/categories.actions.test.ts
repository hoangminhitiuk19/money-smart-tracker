import { CategoryType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCategory,
  deleteCategory,
  updateCategory
} from "@/lib/actions/categories";
import { prisma } from "@/lib/prisma";
import {
  checkAuthenticatedMutation,
  RATE_LIMIT_MESSAGE
} from "@/lib/security/rate-limit";

const mockUser = { id: "user-1", email: "user@test.com", name: "Test User" };

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => mockUser)
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn()
}));

vi.mock("@/lib/security/rate-limit", () => ({
  checkAuthenticatedMutation: vi.fn(async () => ({
    allowed: true,
    unavailable: false,
    limit: 60,
    remaining: 59,
    retryAfterSeconds: 60
  })),
  RATE_LIMIT_MESSAGE: "Too many requests. Please try again shortly."
}));

type FakeCategory = {
  id: string;
  userId: string;
  name: string;
  type: CategoryType;
  defaultCountTowardFeeWaiver: boolean;
};

let categories: FakeCategory[];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (operation: any) =>
      operation((await import("@/lib/prisma")).prisma)
    ),
    category: {
      findFirst: vi.fn(async ({ where }: any) =>
        categories.find((c) => c.id === where.id && c.userId === where.userId) ?? null
      ),
      create: vi.fn(async ({ data }: any) => {
        const record = { id: "new-category", ...data };
        categories.push(record);
        return { id: record.id, name: record.name, type: record.type };
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const target = categories.find(
          (c) => c.id === where.id && c.userId === where.userId
        );

        if (target) {
          Object.assign(target, data);
        }

        return { count: target ? 1 : 0 };
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        const before = categories.length;
        categories = categories.filter(
          (c) => !(c.id === where.id && c.userId === where.userId)
        );
        return { count: before - categories.length };
      })
    },
    transaction: {
      count: vi.fn(async () => 0)
    },
    activityLog: {
      create: vi.fn(async () => ({}))
    }
  }
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkAuthenticatedMutation).mockResolvedValue({
    allowed: true,
    unavailable: false,
    limit: 60,
    remaining: 59,
    retryAfterSeconds: 60
  });
  categories = [
    {
      id: "c1",
      userId: "user-1",
      name: "Groceries",
      type: CategoryType.EXPENSE,
      defaultCountTowardFeeWaiver: true
    }
  ];
});

describe("category activity logging", () => {
  it("denies a rate-limited create before creating a category", async () => {
    vi.mocked(checkAuthenticatedMutation).mockResolvedValueOnce({
      allowed: false,
      unavailable: false,
      limit: 60,
      remaining: 0,
      retryAfterSeconds: 60
    });

    const result = await createCategory({
      name: "Dining",
      type: CategoryType.EXPENSE
    });

    expect(result).toEqual({ ok: false, error: RATE_LIMIT_MESSAGE });
    expect(prisma.category.create).not.toHaveBeenCalled();
  });

  it("writes a CATEGORY_CREATED entry on create", async () => {
    const result = await createCategory({
      name: "Dining",
      type: CategoryType.EXPENSE
    });

    expect(result.ok).toBe(true);
    expect(prisma.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "user-1", action: "CATEGORY_CREATED" })
      })
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function));
  });

  it("writes a CATEGORY_UPDATED entry on update", async () => {
    const result = await updateCategory("c1", {
      name: "Groceries & Household",
      type: CategoryType.EXPENSE
    });

    expect(result.ok).toBe(true);
    expect(prisma.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          action: "CATEGORY_UPDATED",
          entityId: "c1"
        })
      })
    );
  });

  it("writes a CATEGORY_DELETED entry on delete", async () => {
    const result = await deleteCategory("c1");

    expect(result.ok).toBe(true);
    expect(prisma.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          action: "CATEGORY_DELETED",
          entityId: "c1"
        })
      })
    );
  });
});

describe("category fee-waiver defaults", () => {
  it("persists an explicitly selected fee-waiver default when creating a category", async () => {
    const formData = new FormData();
    formData.set("name", "Card purchases");
    formData.set("type", CategoryType.EXPENSE);
    formData.set("color", "");
    formData.set("icon", "");
    formData.set("defaultQualityRating", "");
    formData.set("defaultCountTowardFeeWaiver", "on");

    const result = await createCategory(formData);

    expect(result.ok).toBe(true);
    expect(
      categories.find((category) => category.id === "new-category")
        ?.defaultCountTowardFeeWaiver
    ).toBe(true);
  });

  it("persists an explicitly cleared fee-waiver default when updating a category", async () => {
    const formData = new FormData();
    formData.set("name", "Groceries");
    formData.set("type", CategoryType.EXPENSE);
    formData.set("color", "");
    formData.set("icon", "");
    formData.set("defaultQualityRating", "");

    const result = await updateCategory("c1", formData);

    expect(result.ok).toBe(true);
    expect(categories[0].defaultCountTowardFeeWaiver).toBe(false);
  });
});
