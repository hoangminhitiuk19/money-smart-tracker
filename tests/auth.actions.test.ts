import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerUser } from "@/lib/actions/auth";
import { prisma } from "@/lib/prisma";
import {
  policies,
  RATE_LIMIT_MESSAGE
} from "@/lib/security/rate-limit";

const mocks = vi.hoisted(() => ({
  checkPolicy: vi.fn(),
  checkRegistrationAttempt: vi.fn(),
  create: vi.fn(),
  findUnique: vi.fn(),
  hash: vi.fn(),
  headers: vi.fn(),
  redirect: vi.fn(),
  seedDefaultCategories: vi.fn(),
  transaction: vi.fn()
}));

vi.mock("@/lib/security/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/security/rate-limit")>(
    "@/lib/security/rate-limit"
  );
  return {
    ...actual,
    checkRegistrationAttempt: mocks.checkRegistrationAttempt
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: mocks.findUnique
    },
    $transaction: mocks.transaction
  }
}));

vi.mock("@/lib/category-seed", () => ({
  seedDefaultCategories: mocks.seedDefaultCategories
}));

vi.mock("bcryptjs", () => ({
  hash: mocks.hash
}));

vi.mock("next/headers", () => ({
  headers: mocks.headers
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect
}));

const allowedDecision = {
  allowed: true,
  unavailable: false,
  limit: 5,
  remaining: 4,
  retryAfterSeconds: 60
};

function registrationForm(email = "user@example.com") {
  const formData = new FormData();
  formData.set("email", email);
  formData.set("password", "password123");
  formData.set("name", "Test User");
  return formData;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.checkPolicy.mockResolvedValue(allowedDecision);
  mocks.checkRegistrationAttempt.mockResolvedValue(allowedDecision);
  mocks.create.mockResolvedValue({ id: "new-user" });
  mocks.findUnique.mockResolvedValue(null);
  mocks.hash.mockResolvedValue("hashed-password");
  mocks.headers.mockResolvedValue(
    new Headers({ "x-forwarded-for": "198.51.100.4, 10.0.0.2" })
  );
  mocks.seedDefaultCategories.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation(
    async (callback: (tx: { user: { create: typeof mocks.create } }) => unknown) =>
      callback({ user: { create: mocks.create } })
  );
  mocks.redirect.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
});

describe("registration rate limiting", () => {
  it("validates registration before reading headers or consuming a bucket", async () => {
    const result = await registerUser({}, registrationForm("not-an-email"));

    expect(result).toEqual({
      error: "Enter a valid name, email, and password."
    });
    expect(mocks.headers).not.toHaveBeenCalled();
    expect(mocks.checkRegistrationAttempt).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.seedDefaultCategories).not.toHaveBeenCalled();
  });

  it("stops after registration IP denial before lookup, bcrypt, create, or seeding", async () => {
    mocks.checkRegistrationAttempt.mockResolvedValueOnce({
      ...allowedDecision,
      allowed: false,
      remaining: 0
    });

    const result = await registerUser({}, registrationForm());

    expect(result).toEqual({ error: RATE_LIMIT_MESSAGE });
    expect(mocks.checkRegistrationAttempt).toHaveBeenCalledWith(
      expect.any(Headers),
      "user@example.com"
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.seedDefaultCategories).not.toHaveBeenCalled();
  });

  it("stops the real registration helper after IP denial", async () => {
    const { checkRegistrationAttempt } = await vi.importActual<
      typeof import("@/lib/security/rate-limit")
    >("@/lib/security/rate-limit");
    mocks.checkPolicy.mockResolvedValueOnce({
      ...allowedDecision,
      allowed: false,
      remaining: 0
    });

    const result = await checkRegistrationAttempt(
      new Headers({ "x-forwarded-for": "198.51.100.4, 10.0.0.2" }),
      "user@example.com",
      mocks.checkPolicy
    );

    expect(result.allowed).toBe(false);
    expect(mocks.checkPolicy).toHaveBeenCalledOnce();
    expect(mocks.checkPolicy).toHaveBeenCalledWith(
      policies.registerIp,
      "198.51.100.4"
    );
  });

  it("stops the real registration helper when the IP bucket is unavailable", async () => {
    const { checkRegistrationAttempt } = await vi.importActual<
      typeof import("@/lib/security/rate-limit")
    >("@/lib/security/rate-limit");
    mocks.checkPolicy.mockResolvedValueOnce({
      ...allowedDecision,
      unavailable: true
    });

    const result = await checkRegistrationAttempt(
      new Headers({ "x-forwarded-for": "198.51.100.4, 10.0.0.2" }),
      "user@example.com",
      mocks.checkPolicy
    );

    expect(result).toMatchObject({ allowed: true, unavailable: true });
    expect(mocks.checkPolicy).toHaveBeenCalledOnce();
    expect(mocks.checkPolicy).toHaveBeenCalledWith(
      policies.registerIp,
      "198.51.100.4"
    );
  });

  it("checks IP then normalized email in the real registration helper", async () => {
    const { checkRegistrationAttempt } = await vi.importActual<
      typeof import("@/lib/security/rate-limit")
    >("@/lib/security/rate-limit");
    mocks.checkPolicy
      .mockResolvedValueOnce(allowedDecision)
      .mockResolvedValueOnce({
        ...allowedDecision,
        allowed: false,
        remaining: 0
      });

    const result = await checkRegistrationAttempt(
      new Headers({ "x-forwarded-for": "198.51.100.4, 10.0.0.2" }),
      " User@Example.COM ",
      mocks.checkPolicy
    );

    expect(result.allowed).toBe(false);
    expect(mocks.checkPolicy).toHaveBeenNthCalledWith(
      1,
      policies.registerIp,
      "198.51.100.4"
    );
    expect(mocks.checkPolicy).toHaveBeenNthCalledWith(
      2,
      policies.registerEmail,
      "user@example.com"
    );
  });

  it("returns the generic rate-limit message when storage is unavailable", async () => {
    mocks.checkRegistrationAttempt.mockResolvedValueOnce({
      ...allowedDecision,
      allowed: false,
      unavailable: true,
      remaining: 0
    });

    const result = await registerUser({}, registrationForm());

    expect(result).toEqual({ error: RATE_LIMIT_MESSAGE });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("fails closed when an unavailable decision is inconsistently marked allowed", async () => {
    mocks.checkRegistrationAttempt.mockResolvedValueOnce({
      ...allowedDecision,
      unavailable: true
    });

    const result = await registerUser({}, registrationForm());

    expect(result).toEqual({ error: RATE_LIMIT_MESSAGE });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("uses normalized email for lookup and create after both buckets allow", async () => {
    await expect(
      registerUser({}, registrationForm(" User@Example.COM "))
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: "user@example.com" },
      select: { id: true }
    });
    expect(mocks.hash).toHaveBeenCalledWith("password123", 12);
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        email: "user@example.com",
        name: "Test User",
        passwordHash: "hashed-password"
      },
      select: { id: true }
    });
    expect(mocks.seedDefaultCategories).toHaveBeenCalledWith(
      "new-user",
      expect.objectContaining({ user: expect.any(Object) })
    );
  });

  it("maps a concurrent P2002 create failure to the duplicate-account message", async () => {
    mocks.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "6.19.0"
      })
    );

    const result = await registerUser({}, registrationForm());

    expect(result).toEqual({
      error: "An account with this email already exists."
    });
    expect(mocks.seedDefaultCategories).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
