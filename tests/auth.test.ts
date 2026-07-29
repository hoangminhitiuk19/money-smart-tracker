import { beforeEach, describe, expect, it, vi } from "vitest";
import { authorizeCredentials } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { policies } from "@/lib/security/rate-limit";

const mocks = vi.hoisted(() => ({
  checkLoginAttempt: vi.fn(),
  checkPolicy: vi.fn(),
  compare: vi.fn(),
  findUnique: vi.fn()
}));

vi.mock("@/lib/security/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/security/rate-limit")>(
    "@/lib/security/rate-limit"
  );
  return { ...actual, checkLoginAttempt: mocks.checkLoginAttempt };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: mocks.findUnique
    }
  }
}));

vi.mock("bcryptjs", () => ({
  compare: mocks.compare
}));

vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    NEXTAUTH_SECRET: "test-secret-that-is-at-least-32-characters",
    NEXTAUTH_URL: "http://localhost:3000"
  })
}));

const allowedDecision = {
  allowed: true,
  unavailable: false,
  limit: 20,
  remaining: 19,
  retryAfterSeconds: 60
};

const request = {
  headers: {
    "x-forwarded-for": "203.0.113.8, 10.0.0.1"
  }
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.checkLoginAttempt.mockResolvedValue(allowedDecision);
  mocks.checkPolicy.mockResolvedValue(allowedDecision);
});

describe("credential authorization rate limiting", () => {
  it("validates credentials before consuming a rate-limit bucket", async () => {
    const result = await authorizeCredentials(
      { email: "not-an-email", password: "short" },
      request
    );

    expect(result).toBeNull();
    expect(mocks.checkLoginAttempt).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(mocks.compare).not.toHaveBeenCalled();
  });

  it("stops login after the helper denies without checking user or password", async () => {
    mocks.checkLoginAttempt.mockResolvedValueOnce({
      ...allowedDecision,
      allowed: false,
      remaining: 0
    });

    const result = await authorizeCredentials(
      { email: "user@example.com", password: "password123" },
      request
    );

    expect(result).toBeNull();
    expect(mocks.checkLoginAttempt).toHaveBeenCalledWith(
      request.headers,
      "user@example.com"
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(mocks.compare).not.toHaveBeenCalled();
  });

  it("stops the real login helper after the first forwarded IP bucket denies", async () => {
    const { checkLoginAttempt } = await vi.importActual<
      typeof import("@/lib/security/rate-limit")
    >("@/lib/security/rate-limit");
    mocks.checkPolicy.mockResolvedValueOnce({
      ...allowedDecision,
      allowed: false,
      remaining: 0
    });

    const result = await checkLoginAttempt(
      request.headers,
      "user@example.com",
      mocks.checkPolicy
    );

    expect(result.allowed).toBe(false);
    expect(mocks.checkPolicy).toHaveBeenCalledOnce();
    expect(mocks.checkPolicy).toHaveBeenCalledWith(
      policies.loginIp,
      "203.0.113.8"
    );
  });

  it("uses normalized email for the real helper's second bucket", async () => {
    const { checkLoginAttempt } = await vi.importActual<
      typeof import("@/lib/security/rate-limit")
    >("@/lib/security/rate-limit");
    mocks.checkPolicy
      .mockResolvedValueOnce(allowedDecision)
      .mockResolvedValueOnce({
        ...allowedDecision,
        allowed: false,
        remaining: 0
      });

    const result = await checkLoginAttempt(
      request.headers,
      " User@Example.COM ",
      mocks.checkPolicy
    );

    expect(result.allowed).toBe(false);
    expect(mocks.checkPolicy).toHaveBeenNthCalledWith(
      1,
      policies.loginIp,
      "203.0.113.8"
    );
    expect(mocks.checkPolicy).toHaveBeenNthCalledWith(
      2,
      policies.loginEmail,
      "user@example.com"
    );
  });

  it("returns null without credential work when rate-limit storage is unavailable", async () => {
    mocks.checkLoginAttempt.mockResolvedValueOnce({
      ...allowedDecision,
      allowed: false,
      unavailable: true,
      remaining: 0
    });

    await expect(
      authorizeCredentials(
        { email: "user@example.com", password: "password123" },
        request
      )
    ).resolves.toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(mocks.compare).not.toHaveBeenCalled();
  });

  it("fails closed when an unavailable decision is inconsistently marked allowed", async () => {
    mocks.checkLoginAttempt.mockResolvedValueOnce({
      ...allowedDecision,
      unavailable: true
    });
    mocks.findUnique.mockResolvedValueOnce({
      id: "user-1",
      email: "user@example.com",
      name: "User",
      passwordHash: "stored-hash"
    });
    mocks.compare.mockResolvedValueOnce(true);

    await expect(
      authorizeCredentials(
        { email: "user@example.com", password: "password123" },
        request
      )
    ).resolves.toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(mocks.compare).not.toHaveBeenCalled();
  });

  it("returns null without leaking a user-lookup failure", async () => {
    mocks.findUnique.mockRejectedValueOnce(
      new Error("secret database connection detail")
    );

    await expect(
      authorizeCredentials(
        { email: "user@example.com", password: "password123" },
        request
      )
    ).resolves.toBeNull();
    expect(mocks.compare).not.toHaveBeenCalled();
  });

  it("returns null without leaking a bcrypt failure", async () => {
    mocks.findUnique.mockResolvedValueOnce({
      id: "user-1",
      email: "user@example.com",
      name: "User",
      passwordHash: "stored-hash"
    });
    mocks.compare.mockRejectedValueOnce(
      new Error("secret bcrypt implementation detail")
    );

    await expect(
      authorizeCredentials(
        { email: "user@example.com", password: "password123" },
        request
      )
    ).resolves.toBeNull();
  });

  it("preserves the generic null result for an unknown account", async () => {
    mocks.findUnique.mockResolvedValueOnce(null);

    const result = await authorizeCredentials(
      { email: "USER@example.com", password: "password123" },
      request
    );

    expect(result).toBeNull();
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: "user@example.com" }
    });
    expect(mocks.compare).not.toHaveBeenCalled();
  });

  it("preserves the generic null result for an invalid password", async () => {
    mocks.findUnique.mockResolvedValueOnce({
      id: "user-1",
      email: "user@example.com",
      name: "User",
      passwordHash: "stored-hash"
    });
    mocks.compare.mockResolvedValueOnce(false);

    const result = await authorizeCredentials(
      { email: "user@example.com", password: "wrong-pass" },
      request
    );

    expect(result).toBeNull();
    expect(mocks.compare).toHaveBeenCalledWith("wrong-pass", "stored-hash");
  });

  it("returns the existing safe user shape after both buckets allow", async () => {
    mocks.findUnique.mockResolvedValueOnce({
      id: "user-1",
      email: "user@example.com",
      name: "User",
      passwordHash: "stored-hash"
    });
    mocks.compare.mockResolvedValueOnce(true);

    const result = await authorizeCredentials(
      { email: "user@example.com", password: "password123" },
      request
    );

    expect(result).toEqual({
      id: "user-1",
      email: "user@example.com",
      name: "User"
    });
  });
});
