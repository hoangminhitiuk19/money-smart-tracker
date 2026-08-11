import { randomUUID } from "node:crypto";
import {
  InboundEmailReceiptState,
  InboundMailboxStatus,
  Prisma,
  TransactionDraftOrigin
} from "@prisma/client";
import { INBOUND_DRAFT_RETENTION_MS } from "@/lib/inbound-email/constants";
import { lockOwnedInboundMailbox } from "@/lib/inbound-email/mailbox-lock";
import type { EmailDraftCandidate } from "@/lib/inbound-email/types";
import type { TransactionDraftInput } from "@/lib/transaction-drafts/types";
import { assessDraft } from "@/lib/transaction-drafts/validation";
import type { OwnedTransactionReferences } from "@/lib/transactions/create";

const RECEIPT_NOT_AVAILABLE_ERROR = "Inbound email receipt is not available.";

const emptyOwnedReferences: OwnedTransactionReferences = {
  categories: new Map(),
  expenses: new Set(),
  moneySources: new Map(),
  projects: new Set(),
  recurringPayments: new Set()
};

export async function createEmailDraftFromCandidate(
  db: Prisma.TransactionClient,
  input: {
    userId: string;
    mailboxId: string;
    aliasLocalPart: string;
    receiptId: string;
    candidate: EmailDraftCandidate;
    now: Date;
  }
): Promise<{ draftId: string; captureKey: string; created: boolean }> {
  const mailbox = await lockOwnedInboundMailbox(db, {
    userId: input.userId,
    mailboxId: input.mailboxId
  });
  if (
    !mailbox ||
    mailbox.status !== InboundMailboxStatus.ACTIVE ||
    mailbox.aliasLocalPart !== input.aliasLocalPart
  ) {
    throw new Error(RECEIPT_NOT_AVAILABLE_ERROR);
  }

  await db.$queryRaw(
    Prisma.sql`SELECT 1 FROM "InboundEmailReceipt" WHERE "id" = ${input.receiptId} AND "userId" = ${input.userId} AND "mailboxId" = ${input.mailboxId} FOR UPDATE`
  );

  const receipt = await db.inboundEmailReceipt.findFirst({
    where: {
      id: input.receiptId,
      userId: input.userId,
      mailboxId: input.mailboxId,
      state: InboundEmailReceiptState.PROCESSING
    },
    select: { id: true }
  });
  if (!receipt) {
    throw new Error(RECEIPT_NOT_AVAILABLE_ERROR);
  }

  const existing = await db.transactionDraft.findUnique({
    where: { inboundEmailReceiptId: receipt.id },
    select: { id: true, userId: true, captureKey: true, origin: true }
  });
  if (existing) {
    if (
      existing.userId !== input.userId ||
      existing.origin !== TransactionDraftOrigin.EMAIL
    ) {
      throw new Error(RECEIPT_NOT_AVAILABLE_ERROR);
    }
    return {
      draftId: existing.id,
      captureKey: existing.captureKey,
      created: false
    };
  }

  const captureKey = randomUUID();
  const draft: TransactionDraftInput = {
    captureKey,
    position: 0,
    origin: TransactionDraftOrigin.EMAIL,
    type: input.candidate.type,
    amountText: input.candidate.amountText,
    currency: input.candidate.currency,
    title: input.candidate.title,
    description: input.candidate.description,
    transactionDateText: input.candidate.transactionDateText,
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
    countTowardFeeWaiverTouched: false,
    qualityRatingTouched: false,
    recurringPaymentId: null,
    isInstallmentRelated: false,
    duplicateConfirmed: false,
    duplicateAcknowledgementRequired: false,
    invalidMappedFields: [],
    rawRow: null
  };
  const assessment = assessDraft(draft, emptyOwnedReferences);
  const created = await db.transactionDraft.create({
    data: {
      userId: input.userId,
      captureKey,
      position: 0,
      origin: TransactionDraftOrigin.EMAIL,
      inboundEmailReceiptId: receipt.id,
      confidence: input.candidate.confidence,
      type: input.candidate.type,
      amountText: input.candidate.amountText,
      currency: input.candidate.currency,
      title: input.candidate.title,
      description: input.candidate.description,
      transactionDateText: input.candidate.transactionDateText,
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
      countTowardFeeWaiverTouched: false,
      qualityRatingTouched: false,
      recurringPaymentId: null,
      isInstallmentRelated: false,
      duplicateFingerprint: null,
      duplicateConfirmed: false,
      duplicateAcknowledgementRequired: false,
      invalidMappedFields: [],
      validationIssues: assessment.issues,
      status: assessment.status,
      rawRow: Prisma.DbNull,
      expiresAt: new Date(input.now.getTime() + INBOUND_DRAFT_RETENTION_MS)
    },
    select: { id: true }
  });

  return { draftId: created.id, captureKey, created: true };
}
