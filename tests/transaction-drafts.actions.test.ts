import { TransactionDraftOrigin, TransactionType } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dismissTransactionDrafts,
  listTransactionDrafts,
  savePasteDrafts,
  saveQuickDraft,
  updateTransactionDraft
} from "@/lib/actions/transaction-drafts";
import { prisma } from "@/lib/prisma";
import {
  checkAuthenticatedMutation,
  RATE_LIMIT_MESSAGE
} from "@/lib/security/rate-limit";
import { cleanupExpiredTransactionDrafts } from "@/lib/transaction-drafts/retention";
import type { TransactionDraftInput } from "@/lib/transaction-drafts/types";

const mockUser = { id: "user-1", email: "user@test.com", name: "Test User" };
const captureKey = "550e8400-e29b-41d4-a716-446655440000";
const fakeDbState = vi.hoisted(() => ({ current: null as any }));

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => mockUser)
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

vi.mock("@/lib/transaction-drafts/retention", () => ({
  cleanupExpiredTransactionDrafts: vi.fn(async () => 0)
}));

type FakeDraft = Record<string, any> & {
  id: string;
  userId: string;
  captureKey: string;
  position: number;
};

let drafts: FakeDraft[];
let activities: Array<Record<string, any>>;
let nextId: number;

function matchesWhere(draft: FakeDraft, where: Record<string, any>) {
  if (where.id !== undefined && typeof where.id === "string" && draft.id !== where.id) {
    return false;
  }
  if (where.userId !== undefined && draft.userId !== where.userId) {
    return false;
  }
  if (where.captureKey !== undefined && draft.captureKey !== where.captureKey) {
    return false;
  }
  if (where.id?.in && !where.id.in.includes(draft.id)) {
    return false;
  }
  if (where.position?.gte !== undefined && draft.position < where.position.gte) {
    return false;
  }
  if (where.status?.in && !where.status.in.includes(draft.status)) {
    return false;
  }
  return true;
}

function fakeDatabaseData(data: Record<string, any>) {
  return data.rawRow?.constructor?.name === "DbNull"
    ? { ...data, rawRow: null }
    : data;
}

function fakeRecord(input: TransactionDraftInput, overrides: Partial<FakeDraft> = {}): FakeDraft {
  const createdAt = new Date("2026-08-04T00:00:00.000Z");
  return {
    id: `draft-${nextId++}`,
    userId: mockUser.id,
    status: "NEEDS_REVIEW",
    confidence: null,
    duplicateFingerprint: null,
    validationIssues: [],
    importBatchId: null,
    importedTransactionId: null,
    expiresAt: new Date("2026-09-03T00:00:00.000Z"),
    createdAt,
    updatedAt: createdAt,
    ...input,
    ...overrides
  };
}

const fakeDb = {
  category: { findMany: vi.fn(async () => []) },
  moneySource: {
    findMany: vi.fn(async ({ where }: any) =>
      where.id.in.includes("bank-a")
        ? [{ id: "bank-a", type: "BANK_ACCOUNT" }]
        : []
    )
  },
  financialProject: { findMany: vi.fn(async () => []) },
  transaction: { findMany: vi.fn(async () => []) },
  recurringPayment: { findMany: vi.fn(async () => []) },
  transactionDraft: {
    findMany: vi.fn(async ({ where }: any) =>
      drafts
        .filter((draft) => matchesWhere(draft, where))
        .sort((left, right) => left.position - right.position)
        .map((draft) => ({ ...draft }))
    ),
    findFirst: vi.fn(async ({ where }: any) => {
      const draft = drafts.find((candidate) => matchesWhere(candidate, where));
      return draft ? { ...draft } : null;
    }),
    upsert: vi.fn(async ({ where, create, update }: any) => {
      const key = where.userId_captureKey_position;
      const existing = drafts.find(
        (draft) =>
          draft.userId === key.userId &&
          draft.captureKey === key.captureKey &&
          draft.position === key.position
      );
      if (existing) {
        Object.assign(existing, update, { updatedAt: new Date() });
        return { ...existing };
      }
      const record = fakeRecord(create, { userId: create.userId });
      drafts.push(record);
      return { ...record };
    }),
    create: vi.fn(async ({ data }: any) => {
      const record = fakeRecord(data, { userId: data.userId });
      drafts.push(record);
      return { ...record };
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const existing = drafts.find((draft) => draft.id === where.id);
      if (!existing) throw new Error("missing draft");
      Object.assign(existing, data, { updatedAt: new Date() });
      return { ...existing };
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const selected = drafts.filter((draft) => matchesWhere(draft, where));
      selected.forEach((draft) =>
        Object.assign(draft, fakeDatabaseData(data), { updatedAt: new Date() })
      );
      return { count: selected.length };
    }),
    deleteMany: vi.fn(async ({ where }: any) => {
      const before = drafts.length;
      drafts = drafts.filter((draft) => !matchesWhere(draft, where));
      return { count: before - drafts.length };
    })
  },
  activityLog: {
    create: vi.fn(async ({ data }: any) => {
      activities.push(data);
      return data;
    })
  }
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (operation: any) => operation(fakeDbState.current)),
    transactionDraft: {
      findMany: vi.fn((...args: any[]) =>
        fakeDbState.current.transactionDraft.findMany(...args)
      )
    }
  }
}));

function expenseDraft(overrides: Partial<TransactionDraftInput> = {}): TransactionDraftInput {
  return {
    captureKey,
    position: 0,
    origin: TransactionDraftOrigin.PASTE,
    type: TransactionType.EXPENSE,
    amountText: "45.00",
    currency: "VND",
    title: "Lunch",
    description: null,
    transactionDateText: "2026-08-04",
    categoryId: null,
    qualityRating: null,
    fromMoneySourceId: "bank-a",
    toMoneySourceId: null,
    adjustedMoneySourceId: null,
    adjustmentDirection: null,
    adjustmentTarget: null,
    projectId: null,
    relatedTransactionId: null,
    countTowardFeeWaiver: null,
    recurringPaymentId: null,
    isInstallmentRelated: false,
    duplicateConfirmed: false,
    rawRow: { Amount: "45.00" },
    ...overrides
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-04T00:00:00.000Z"));
  vi.clearAllMocks();
  vi.mocked(checkAuthenticatedMutation).mockResolvedValue({
    allowed: true,
    unavailable: false,
    limit: 60,
    remaining: 59,
    retryAfterSeconds: 60
  });
  drafts = [];
  activities = [];
  nextId = 1;
  fakeDbState.current = fakeDb;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("transaction draft save contracts", () => {
  it("saves bounded paste rows, preserves exact money text, and returns serializable views", async () => {
    const result = await savePasteDrafts({
      captureKey,
      rows: [expenseDraft()]
    });

    expect(result).toMatchObject({
      ok: true,
      drafts: [{ origin: "PASTE", status: "READY", amountText: "45.00" }]
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(drafts[0].duplicateFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(drafts[0].expiresAt.toISOString()).toBe("2026-09-03T00:00:00.000Z");
  });

  it("rejects non-contiguous paste rows and oversized raw values before writing", async () => {
    const aggregateOversizedRows = Array.from({ length: 200 }, (_, position) =>
      expenseDraft({ position, rawRow: { Note: "é".repeat(3_000) } })
    );
    const [nonContiguous, oversized, tooMany, aggregateOversized] = await Promise.all([
      savePasteDrafts({
        captureKey,
        rows: [expenseDraft({ position: 1 })]
      }),
      savePasteDrafts({
        captureKey,
        rows: [expenseDraft({ rawRow: { Amount: "x".repeat(10_001) } })]
      }),
      savePasteDrafts({
        captureKey,
        rows: Array.from({ length: 201 }, (_, position) => expenseDraft({ position }))
      }),
      savePasteDrafts({
        captureKey,
        rows: aggregateOversizedRows
      })
    ]);

    expect(nonContiguous).toMatchObject({ ok: false });
    expect(oversized).toMatchObject({ ok: false });
    expect(tooMany).toMatchObject({ ok: false });
    expect(aggregateOversized).toMatchObject({ ok: false });
    expect(fakeDb.transactionDraft.upsert).not.toHaveBeenCalled();
  });

  it("deletes only surplus rows in the owned capture when replacing a paste", async () => {
    drafts = [
      fakeRecord(expenseDraft({ position: 0 }), { origin: TransactionDraftOrigin.QUICK }),
      fakeRecord(expenseDraft({ position: 1, title: "Dinner" })),
      fakeRecord(expenseDraft({ position: 2, title: "Coffee" })),
      fakeRecord(expenseDraft({ captureKey: "f03a2c0d-d6d2-452e-842b-bce9bdb89cc7", position: 1 }))
    ];

    const result = await savePasteDrafts({
      captureKey,
      rows: [expenseDraft({ title: "Replacement" })]
    });

    expect(result).toMatchObject({
      ok: true,
      drafts: [{ title: "Replacement", origin: "PASTE" }]
    });
    expect(drafts.filter((draft) => draft.captureKey === captureKey)).toHaveLength(1);
    expect(drafts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ captureKey: "f03a2c0d-d6d2-452e-842b-bce9bdb89cc7" })
      ])
    );
  });

  it("writes one QUICK draft through the same assessment path", async () => {
    const result = await saveQuickDraft(
      expenseDraft({ origin: TransactionDraftOrigin.QUICK })
    );

    expect(result).toMatchObject({
      ok: true,
      draft: { origin: "QUICK", status: "READY", amountText: "45.00" }
    });
  });

  it("returns the rate-limit error and performs zero writes", async () => {
    vi.mocked(checkAuthenticatedMutation).mockResolvedValueOnce({
      allowed: false,
      unavailable: false,
      limit: 60,
      remaining: 0,
      retryAfterSeconds: 30
    });

    await expect(
      savePasteDrafts({ captureKey, rows: [expenseDraft()] })
    ).resolves.toEqual({ ok: false, error: RATE_LIMIT_MESSAGE });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(fakeDb.transactionDraft.upsert).not.toHaveBeenCalled();
  });
});

describe("transaction draft owned reads and mutations", () => {
  it("lists only the authenticated capture in position order", async () => {
    drafts = [
      fakeRecord(expenseDraft({ position: 1, title: "Second" })),
      fakeRecord(expenseDraft({ position: 0, title: "First" })),
      fakeRecord(expenseDraft(), { userId: "user-2" })
    ];

    const result = await listTransactionDrafts(captureKey);

    expect(result).toMatchObject({
      ok: true,
      drafts: [{ title: "First" }, { title: "Second" }]
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("contains retention cleanup failures and logs only their error class", async () => {
    drafts = [fakeRecord(expenseDraft({ title: "Still reachable" }))];
    vi.mocked(cleanupExpiredTransactionDrafts).mockRejectedValueOnce(
      new TypeError("secret draft value 45.00")
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(listTransactionDrafts(captureKey)).resolves.toMatchObject({
      ok: true,
      drafts: [{ title: "Still reachable" }]
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "Transaction draft retention cleanup failed.",
      { errorClass: "TypeError" }
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("45.00");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("Still reachable");
    errorSpy.mockRestore();
  });

  it("returns safe not-found for a foreign draft update", async () => {
    drafts = [fakeRecord(expenseDraft(), { id: "foreign-draft", userId: "user-2" })];

    await expect(
      updateTransactionDraft("foreign-draft", { title: "Stolen update" })
    ).resolves.toEqual({ ok: false, error: "Draft not found." });
    expect(fakeDb.transactionDraft.update).not.toHaveBeenCalled();
  });

  it("revalidates a merged patch and never accepts client status or issues", async () => {
    drafts = [fakeRecord(expenseDraft(), { id: "owned-draft" })];

    const invalid = await updateTransactionDraft("owned-draft", {
      status: "READY",
      validationIssues: []
    });
    const oversized = await updateTransactionDraft("owned-draft", {
      rawRow: { Note: "x".repeat(10_001) }
    });
    expect(fakeDb.transactionDraft.update).not.toHaveBeenCalled();
    const updated = await updateTransactionDraft("owned-draft", {
      amountText: "45.000",
      title: "Updated lunch"
    });

    expect(invalid).toMatchObject({ ok: false });
    expect(oversized).toMatchObject({ ok: false });
    expect(updated).toMatchObject({
      ok: true,
      draft: { amountText: "45.000", title: "Updated lunch", status: "READY" }
    });
  });

  it("dismisses only owned IDs, clears candidate data, and logs count plus origin", async () => {
    drafts = [
      fakeRecord(expenseDraft(), { id: "owned-draft" }),
      fakeRecord(expenseDraft({ position: 1 }), { id: "foreign-draft", userId: "user-2" })
    ];

    const result = await dismissTransactionDrafts(["owned-draft", "foreign-draft"]);

    expect(result).toEqual({ ok: true, dismissedCount: 1 });
    expect(drafts[0]).toMatchObject({
      status: "DISMISSED",
      amountText: null,
      title: null,
      rawRow: null,
      duplicateFingerprint: null,
      validationIssues: []
    });
    expect(drafts[1].status).toBe("NEEDS_REVIEW");
    expect(activities).toEqual([
      expect.objectContaining({
        userId: mockUser.id,
        action: "TRANSACTION_DRAFTS_DISMISSED",
        metadata: { count: 1, origin: "PASTE" }
      })
    ]);
    expect(JSON.stringify(activities)).not.toContain("owned-draft");
    expect(JSON.stringify(activities)).not.toContain("foreign-draft");
    expect(JSON.stringify(activities)).not.toContain("45.00");
  });

  it("logs a metadata-only MIXED origin for a mixed owned dismissal", async () => {
    drafts = [
      fakeRecord(expenseDraft(), { id: "paste-draft" }),
      fakeRecord(expenseDraft({
        captureKey: "34ac7c99-d2ee-491d-bac5-f4ad10155596",
        origin: TransactionDraftOrigin.QUICK
      }), { id: "quick-draft" })
    ];

    await expect(
      dismissTransactionDrafts(["paste-draft", "quick-draft"])
    ).resolves.toEqual({ ok: true, dismissedCount: 2 });
    expect(activities[0].metadata).toEqual({ count: 2, origin: "MIXED" });
    expect(Object.keys(activities[0].metadata)).toEqual(["count", "origin"]);
  });
});
