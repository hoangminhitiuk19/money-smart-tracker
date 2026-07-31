import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUserSettings, updateUserSettings } from "@/lib/actions/settings";
import { prisma } from "@/lib/prisma";
import {
  checkAuthenticatedMutation,
  RATE_LIMIT_MESSAGE
} from "@/lib/security/rate-limit";
import { compare, hash } from "bcryptjs";
import { revalidatePath } from "next/cache";

const mockUser = { id: "user-1", email: "user@test.com", name: "Test User" };

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => mockUser)
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn()
}));

vi.mock("bcryptjs", () => ({
  compare: vi.fn(async () => true),
  hash: vi.fn(async () => "new-password-hash")
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

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => ({ passwordHash: "current-password-hash" })),
      update: vi.fn(async () => ({}))
    },
    userSettings: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async () => ({}))
    },
    $transaction: vi.fn(async () => [])
  }
}));

function validSettingsForm() {
  const formData = new FormData();
  formData.set("dateFormat", "DD/MM/YYYY");
  formData.set("defaultCurrency", "VND");
  formData.set("defaultDashboardPeriod", "Month");
  formData.set("name", "Test User");
  formData.set("numberFormat", "1,000,000");
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkAuthenticatedMutation).mockResolvedValue({
    allowed: true,
    unavailable: false,
    limit: 60,
    remaining: 59,
    retryAfterSeconds: 60
  });
});

describe("settings mutation rate limiting", () => {
  it("denies a rate-limited update before user lookup, password work, or transaction", async () => {
    vi.mocked(checkAuthenticatedMutation).mockResolvedValueOnce({
      allowed: false,
      unavailable: false,
      limit: 60,
      remaining: 0,
      retryAfterSeconds: 60
    });

    const result = await updateUserSettings({}, validSettingsForm());

    expect(result).toEqual({ error: RATE_LIMIT_MESSAGE });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(compare).not.toHaveBeenCalled();
    expect(hash).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("settings initialization", () => {
  it("returns the persisted row to both concurrent initializers when one loses the unique race", async () => {
    const persistedSettings = {
      id: "settings-1",
      userId: "user-1",
      defaultCurrency: "VND",
      dateFormat: "DD/MM/YYYY",
      numberFormat: "1,000,000",
      defaultDashboardPeriod: "Month",
      createdAt: new Date("2026-07-31T00:00:00.000Z"),
      updatedAt: new Date("2026-07-31T00:00:00.000Z")
    };
    vi.mocked(prisma.userSettings.upsert)
      .mockResolvedValueOnce(persistedSettings)
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "6.19.0"
        })
      );
    vi.mocked(prisma.userSettings.findUnique).mockResolvedValueOnce(
      persistedSettings
    );

    await expect(
      Promise.all([getUserSettings(), getUserSettings()])
    ).resolves.toEqual([
      { settings: persistedSettings, user: mockUser },
      { settings: persistedSettings, user: mockUser }
    ]);
  });
});

describe("settings mutation validation and ownership", () => {
  it("rejects an invalid currency before any account or settings write", async () => {
    const formData = validSettingsForm();
    formData.set("defaultCurrency", "US");

    const result = await updateUserSettings({}, formData);

    expect(result).toEqual({ error: "Use a three-letter currency code." });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("scopes profile and display settings writes to the authenticated user", async () => {
    const formData = validSettingsForm();
    formData.set("email", "other-user@test.com");

    await expect(updateUserSettings({}, formData)).resolves.toEqual({
      success: "Settings saved."
    });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { name: "Test User" }
    });
    expect(prisma.userSettings.upsert).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      create: {
        userId: "user-1",
        defaultCurrency: "VND",
        dateFormat: "DD/MM/YYYY",
        numberFormat: "1,000,000",
        defaultDashboardPeriod: "Month"
      },
      update: {
        defaultCurrency: "VND",
        dateFormat: "DD/MM/YYYY",
        numberFormat: "1,000,000",
        defaultDashboardPeriod: "Month"
      }
    });
    expect(prisma.user.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: expect.anything() })
      })
    );
  });

  it("does not write when the current password is incorrect", async () => {
    vi.mocked(
      compare as (data: string, encrypted: string) => Promise<boolean>
    ).mockResolvedValueOnce(false);
    const formData = validSettingsForm();
    formData.set("currentPassword", "wrong-password");
    formData.set("newPassword", "new-password");
    formData.set("confirmPassword", "new-password");

    const result = await updateUserSettings({}, formData);

    expect(result).toEqual({ error: "Current password is incorrect." });
    expect(hash).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("revalidates every page that renders persisted display settings", async () => {
    await updateUserSettings({}, validSettingsForm());

    expect(vi.mocked(revalidatePath).mock.calls.map(([path]) => path)).toEqual([
      "/settings",
      "/dashboard",
      "/accounts",
      "/goals",
      "/projects",
      "/renewals",
      "/reports",
      "/transactions"
    ]);
  });

  it("rejects an overlong profile name before account lookup", async () => {
    const formData = validSettingsForm();
    formData.set("name", "a".repeat(101));

    const result = await updateUserSettings({}, formData);

    expect(result).toEqual({ error: "Name must be 100 characters or fewer." });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a password longer than bcrypt's supported boundary", async () => {
    const formData = validSettingsForm();
    formData.set("currentPassword", "current-password");
    formData.set("newPassword", "a".repeat(73));
    formData.set("confirmPassword", "a".repeat(73));

    const result = await updateUserSettings({}, formData);

    expect(result).toEqual({
      error: "New password must be 72 bytes or fewer."
    });
    expect(compare).not.toHaveBeenCalled();
    expect(hash).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("measures the bcrypt password boundary in UTF-8 bytes", async () => {
    const formData = validSettingsForm();
    formData.set("currentPassword", "current-password");
    formData.set("newPassword", "€".repeat(25));
    formData.set("confirmPassword", "€".repeat(25));

    const result = await updateUserSettings({}, formData);

    expect(result).toEqual({
      error: "New password must be 72 bytes or fewer."
    });
    expect(compare).not.toHaveBeenCalled();
    expect(hash).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("does not expose password verification failures", async () => {
    vi.mocked(
      compare as (data: string, encrypted: string) => Promise<boolean>
    ).mockRejectedValueOnce(new Error("bcrypt-internal-secret"));
    const formData = validSettingsForm();
    formData.set("currentPassword", "current-password");
    formData.set("newPassword", "new-password");
    formData.set("confirmPassword", "new-password");

    await expect(
      updateUserSettings({}, formData)
    ).resolves.toEqual({ error: "Unable to save settings." });
    expect(hash).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns a safe error when persistence fails", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(
      new Error("database-internal-secret")
    );

    await expect(
      updateUserSettings({}, validSettingsForm())
    ).resolves.toEqual({ error: "Unable to save settings." });
  });
});
