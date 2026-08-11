import { Prisma, TransactionDraftOrigin, TransactionType } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { createEmailDraftFromCandidate } from "@/lib/inbound-email/email-drafts";
import type { EmailDraftCandidate } from "@/lib/inbound-email/types";
import {
  storedTransactionDraftInputSchema,
  transactionDraftInputSchema,
  type TransactionDraftInput
} from "@/lib/transaction-drafts/types";

const candidate: EmailDraftCandidate = {
  type: "EXPENSE",
  amountText: "125000",
  currency: "VND",
  transactionDateText: "2026-08-10",
  title: "Demo Cafe",
  description: "Synthetic inbound-email test data.",
  confidence: 100
};

const storedDraft: TransactionDraftInput = {
  captureKey: "550e8400-e29b-41d4-a716-446655440000",
  position: 0,
  origin: TransactionDraftOrigin.EMAIL,
  type: TransactionType.EXPENSE,
  amountText: candidate.amountText,
  currency: candidate.currency,
  title: candidate.title,
  description: candidate.description,
  transactionDateText: candidate.transactionDateText,
  categoryId: null,
  qualityRating: null,
  fromMoneySourceId: null,
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
  rawRow: null
};

function verifiedDb(options: { enforceLockOrder?: boolean } = {}) {
  const lockState = { mailbox: false, receipt: false, violated: false };
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "draft-1",
    captureKey: data.captureKey
  }));
  const findUnique = vi
    .fn()
    .mockResolvedValueOnce(null)
    .mockResolvedValue({
      id: "draft-1",
      userId: "user-1",
      captureKey: storedDraft.captureKey,
      origin: "EMAIL"
    });
  const mailboxRecord = {
    id: "mailbox-1",
    userId: "user-1",
    aliasLocalPart: "alias-current",
    status: "ACTIVE"
  };
  const findFirst = vi.fn(async (): Promise<any> => {
    if (
      options.enforceLockOrder &&
      (!lockState.mailbox || !lockState.receipt || lockState.violated)
    ) {
      return null;
    }
    return {
      id: "receipt-1",
      userId: "user-1",
      mailboxId: "mailbox-1",
      mailbox: mailboxRecord
    };
  });
  const queryRaw = vi.fn(async (query: Prisma.Sql) => {
    const statement = query.strings.join(" ");
    if (statement.includes('FROM "InboundMailbox"')) {
      lockState.mailbox = true;
      return [{ id: "mailbox-1" }];
    }
    if (statement.includes('FROM "InboundEmailReceipt"')) {
      if (!lockState.mailbox) lockState.violated = true;
      lockState.receipt = true;
      return [{ id: "receipt-1" }];
    }
    return [];
  });

  return {
    db: {
      $queryRaw: queryRaw,
      inboundMailbox: {
        findUnique: vi.fn(async () => mailboxRecord)
      },
      inboundEmailReceipt: { findFirst },
      transactionDraft: { findUnique, create },
      transaction: { create: vi.fn() }
    } as unknown as Prisma.TransactionClient,
    create,
    findFirst,
    findUnique
  };
}

describe("server-only email draft boundary", () => {
  it("locks the owned mailbox before the owned receipt and draft creation", async () => {
    const { db } = verifiedDb({ enforceLockOrder: true });

    await expect(
      createEmailDraftFromCandidate(db, {
        userId: "user-1",
        mailboxId: "mailbox-1",
        aliasLocalPart: "alias-current",
        receiptId: "receipt-1",
        candidate,
        now: new Date("2026-08-10T12:00:00.000Z")
      })
    ).resolves.toMatchObject({ created: true });
  });

  it("rejects EMAIL at the public schema while accepting a persisted EMAIL record", () => {
    expect(transactionDraftInputSchema.safeParse(storedDraft).success).toBe(false);
    expect(storedTransactionDraftInputSchema.safeParse(storedDraft).success).toBe(true);
  });

  it("creates one review-only draft from an owned active receipt", async () => {
    const { db, create } = verifiedDb();
    const now = new Date("2026-08-10T12:00:00.000Z");
    const candidateWithInjectedReferences = {
      ...candidate,
      categoryId: "category-injected",
      fromMoneySourceId: "source-injected",
      projectId: "project-injected",
      relatedTransactionId: "transaction-injected"
    } as EmailDraftCandidate;

    const result = await createEmailDraftFromCandidate(db, {
      userId: "user-1",
      mailboxId: "mailbox-1",
      aliasLocalPart: "alias-current",
      receiptId: "receipt-1",
      candidate: candidateWithInjectedReferences,
      now
    });

    expect(result).toEqual({
      draftId: "draft-1",
      captureKey: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      ),
      created: true
    });
    expect(create).toHaveBeenCalledOnce();
    const createData = create.mock.calls[0]?.[0].data;
    expect(createData).toEqual(
      expect.objectContaining({
        userId: "user-1",
        origin: "EMAIL",
        inboundEmailReceiptId: "receipt-1",
        position: 0,
        type: "EXPENSE",
        amountText: "125000",
        currency: "VND",
        title: "Demo Cafe",
        status: "NEEDS_REVIEW",
        confidence: 100,
        categoryId: null,
        fromMoneySourceId: null,
        projectId: null,
        relatedTransactionId: null,
        rawRow: Prisma.DbNull,
        expiresAt: new Date("2026-09-09T12:00:00.000Z")
      })
    );
    expect(createData?.validationIssues).toContainEqual({
      field: "fromMoneySourceId",
      message: "Expense requires a from money source."
    });
    expect((db as any).transaction.create).not.toHaveBeenCalled();
  });

  it("replays the draft already linked to the receipt without creating another", async () => {
    const { db, create, findUnique } = verifiedDb();
    findUnique.mockReset();
    findUnique.mockResolvedValue({
      id: "draft-existing",
      userId: "user-1",
      captureKey: storedDraft.captureKey,
      origin: "EMAIL"
    });

    await expect(
      createEmailDraftFromCandidate(db, {
        userId: "user-1",
        mailboxId: "mailbox-1",
        aliasLocalPart: "alias-current",
        receiptId: "receipt-1",
        candidate,
        now: new Date("2026-08-10T12:00:00.000Z")
      })
    ).resolves.toEqual({
      draftId: "draft-existing",
      captureKey: storedDraft.captureKey,
      created: false
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects replay provenance linked to another owner", async () => {
    const { db, create, findUnique } = verifiedDb();
    findUnique.mockReset();
    findUnique.mockResolvedValue({
      id: "draft-foreign",
      userId: "user-2",
      captureKey: storedDraft.captureKey,
      origin: "EMAIL"
    });

    await expect(
      createEmailDraftFromCandidate(db, {
        userId: "user-1",
        mailboxId: "mailbox-1",
        aliasLocalPart: "alias-current",
        receiptId: "receipt-1",
        candidate,
        now: new Date("2026-08-10T12:00:00.000Z")
      })
    ).rejects.toThrow("Inbound email receipt is not available.");
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong owner", { userId: "user-2" }],
    ["wrong mailbox", { mailboxId: "mailbox-2" }],
    ["stale alias", { aliasLocalPart: "alias-old" }]
  ])("fails safely for a %s combination", async (_label, override) => {
    const { db, create, findFirst } = verifiedDb();
    findFirst.mockResolvedValueOnce(null);

    await expect(
      createEmailDraftFromCandidate(db, {
        userId: "user-1",
        mailboxId: "mailbox-1",
        aliasLocalPart: "alias-current",
        receiptId: "receipt-1",
        candidate,
        now: new Date("2026-08-10T12:00:00.000Z"),
        ...override
      })
    ).rejects.toThrow("Inbound email receipt is not available.");
    expect(create).not.toHaveBeenCalled();
  });
});
