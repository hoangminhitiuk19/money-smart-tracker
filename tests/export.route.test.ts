import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/export/transactions/route";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  checkExport,
  RATE_LIMIT_MESSAGE
} from "@/lib/security/rate-limit";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  checkExport: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireAuth: mocks.requireAuth
}));

vi.mock("@/lib/security/rate-limit", () => ({
  checkExport: mocks.checkExport,
  RATE_LIMIT_MESSAGE: "Too many requests. Please try again shortly."
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: { findMany: mocks.findMany },
    activityLog: { create: mocks.create }
  }
}));

const allowedDecision = {
  allowed: true,
  unavailable: false,
  limit: 10,
  remaining: 9,
  retryAfterSeconds: 60
};

const mockUser = { id: "user-1", email: "user@example.com", name: "Test User" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(mockUser);
  vi.mocked(checkExport).mockResolvedValue(allowedDecision);
  vi.mocked(prisma.transaction.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.activityLog.create).mockResolvedValue({} as never);
});

describe("GET /api/export/transactions", () => {
  it("returns 401 before consuming an export token when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce(null);

    const response = await GET(
      new Request("http://localhost/api/export/transactions")
    );

    expect(response.status).toBe(401);
    expect(checkExport).not.toHaveBeenCalled();
    expect(prisma.transaction.findMany).not.toHaveBeenCalled();
    expect(prisma.activityLog.create).not.toHaveBeenCalled();
  });

  it("rejects a rate-limited authenticated export before query or activity logging", async () => {
    vi.mocked(checkExport).mockResolvedValueOnce({
      ...allowedDecision,
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 30
    });

    const response = await GET(
      new Request("http://localhost/api/export/transactions")
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("Retry-After")).toBe("30");
    await expect(response.text()).resolves.toBe(RATE_LIMIT_MESSAGE);
    expect(checkExport).toHaveBeenCalledWith("user-1");
    expect(prisma.transaction.findMany).not.toHaveBeenCalled();
    expect(prisma.activityLog.create).not.toHaveBeenCalled();
  });

  it("exports CSV and records CSV_EXPORTED when the export token is allowed", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValueOnce([
      {
        transactionDate: new Date("2026-01-02T03:04:05.000Z"),
        type: "EXPENSE",
        title: "Coffee",
        amount: { toString: () => "4.50" },
        currency: "USD",
        category: { name: "Food" },
        qualityRating: "A",
        fromMoneySource: { name: "Cash" },
        toMoneySource: null,
        project: null,
        description: "Morning coffee",
        countTowardFeeWaiver: true,
        createdAt: new Date("2026-01-02T03:04:06.000Z")
      }
    ] as never);

    const response = await GET(
      new Request("http://localhost/api/export/transactions")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="transactions.csv"'
    );
    await expect(response.text()).resolves.toBe(
      [
        "Date,Type,Title,Amount,Currency,Category,Quality Rating,From Source,To Source,Project,Description,Count Toward Fee Waiver,Created At",
        '\"2026-01-02T03:04:05.000Z\",\"EXPENSE\",\"Coffee\",\"4.50\",\"USD\",\"Food\",\"A\",\"Cash\",\"\",\"\",\"Morning coffee\",\"true\",\"2026-01-02T03:04:06.000Z\"'
      ].join("\n")
    );
    expect(checkExport).toHaveBeenCalledWith("user-1");
    expect(prisma.transaction.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", transactionDate: undefined },
      orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
      include: {
        category: true,
        fromMoneySource: true,
        toMoneySource: true,
        project: true
      }
    });
    expect(prisma.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        action: "CSV_EXPORTED",
        entityType: "Transaction",
        metadata: expect.objectContaining({ rowCount: 1 })
      })
    });
  });
});
