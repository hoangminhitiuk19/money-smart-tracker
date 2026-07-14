import { CategoryType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCategory,
  deleteCategory,
  updateCategory
} from "@/lib/actions/categories";
import { prisma } from "@/lib/prisma";

const mockUser = { id: "user-1", email: "user@test.com", name: "Test User" };

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => mockUser)
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn()
}));

type FakeCategory = {
  id: string;
  userId: string;
  name: string;
  type: CategoryType;
};

let categories: FakeCategory[];

vi.mock("@/lib/prisma", () => ({
  prisma: {
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
  categories = [
    { id: "c1", userId: "user-1", name: "Groceries", type: CategoryType.EXPENSE }
  ];
});

describe("category activity logging", () => {
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
