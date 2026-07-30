import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateUserSettings } from "@/lib/actions/settings";
import { prisma } from "@/lib/prisma";
import {
  checkAuthenticatedMutation,
  RATE_LIMIT_MESSAGE
} from "@/lib/security/rate-limit";
import { compare, hash } from "bcryptjs";

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
    userSettings: { upsert: vi.fn(async () => ({})) },
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
