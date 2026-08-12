import {
  InboundEmailDisposition,
  InboundEmailReceiptState,
  InboundMailboxProvider,
  InboundMailboxStatus,
  type Prisma
} from "@prisma/client";
import { MAX_INBOUND_CONTENT_BYTES } from "@/lib/inbound-email/constants";
import { createEmailDraftFromCandidate } from "@/lib/inbound-email/email-drafts";
import { lockOwnedInboundMailbox } from "@/lib/inbound-email/mailbox-lock";
import {
  claimInboundEmailReceipt,
  findActiveMailboxForRecipient,
  markInboundReceipt,
  parseInboundEmailRecipient,
  type InboundReceiptClaim
} from "@/lib/inbound-email/receipts";
import { cleanupExpiredInboundEmailData } from "@/lib/inbound-email/retention";
import { parseSyntheticInboundMessage } from "@/lib/inbound-email/synthetic-parser";
import type {
  EmailDraftCandidate,
  InboundEmailProvider,
  InboundMessage,
  InboundNotification
} from "@/lib/inbound-email/types";
import { prisma } from "@/lib/prisma";
import { checkInboundEmailAlias } from "@/lib/security/rate-limit";

const DEFAULT_RETRIEVAL_TIMEOUT_MS = 10_000;

type ResolvedMailbox = NonNullable<
  Awaited<ReturnType<typeof findActiveMailboxForRecipient>>
>;
type ClaimedReceipt = InboundReceiptClaim["receipt"];

export type InboundWebhookDependencies = {
  provider: InboundEmailProvider;
  now: () => Date;
  resolveMailbox: typeof findActiveMailboxForRecipient;
  claimReceipt: typeof claimInboundEmailReceipt;
  checkAliasRateLimit: typeof checkInboundEmailAlias;
  parseMessage: typeof parseSyntheticInboundMessage;
  createDraft: typeof createEmailDraftFromCandidate;
  markReceipt: typeof markInboundReceipt;
  cleanup: typeof cleanupExpiredInboundEmailData;
  runTransaction: <T>(
    operation: (db: Prisma.TransactionClient) => Promise<T>
  ) => Promise<T>;
  timeoutMs: number;
};

export type InboundWebhookResult = {
  status: 200 | 400 | 401 | 413 | 503;
  code:
    | "ACCEPTED"
    | "IGNORED"
    | "DUPLICATE"
    | "INVALID"
    | "OVERSIZED"
    | "RETRY";
};

type FinalizeInput = {
  mailbox: ResolvedMailbox;
  receipt: ClaimedReceipt;
  now: Date;
  state: typeof InboundEmailReceiptState.IGNORED
    | typeof InboundEmailReceiptState.PROCESSED
    | typeof InboundEmailReceiptState.RETRYABLE_FAILED
    | typeof InboundEmailReceiptState.TERMINAL_FAILED;
  disposition: InboundEmailDisposition;
  candidate?: EmailDraftCandidate;
};

function result(
  status: InboundWebhookResult["status"],
  code: InboundWebhookResult["code"]
): InboundWebhookResult {
  return { status, code };
}

function safeErrorCode(error: unknown): string | null {
  try {
    if (typeof error !== "object" || error === null) return null;
    const code = Reflect.get(error, "code");
    return typeof code === "string" ? code : null;
  } catch {
    return null;
  }
}

function safeErrorClass(error: unknown) {
  try {
    const name =
      error instanceof Error && typeof error.constructor?.name === "string"
        ? error.constructor.name
        : "UnknownError";
    return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name)
      ? name
      : "UnknownError";
  } catch {
    return "UnknownError";
  }
}

function contentBytes(message: InboundMessage) {
  const encoder = new TextEncoder();
  return (
    (message.text === null ? 0 : encoder.encode(message.text).byteLength) +
    (message.html === null ? 0 : encoder.encode(message.html).byteLength)
  );
}

async function retrieveWithTimeout(
  provider: InboundEmailProvider,
  messageId: string,
  timeoutMs: number
): Promise<
  | { kind: "message"; message: InboundMessage }
  | { kind: "error"; error: unknown }
  | { kind: "timeout" }
> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const retrieval = provider.retrieveMessage(messageId, controller.signal).then(
    (message) => ({ kind: "message" as const, message }),
    (error: unknown) => ({ kind: "error" as const, error })
  );
  const timeout = new Promise<{ kind: "timeout" }>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ kind: "timeout" });
    }, Math.max(1, Math.floor(timeoutMs)));
  });

  try {
    return await Promise.race([retrieval, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function currentOwnedMailbox(
  db: Prisma.TransactionClient,
  mailbox: ResolvedMailbox
) {
  return lockOwnedInboundMailbox(db, {
    userId: mailbox.userId,
    mailboxId: mailbox.id
  });
}

async function markInactiveReceipt(
  dependencies: InboundWebhookDependencies,
  db: Prisma.TransactionClient,
  receipt: ClaimedReceipt
) {
  await dependencies.markReceipt(db, {
    id: receipt.id,
    userId: receipt.userId,
    mailboxId: receipt.mailboxId,
    state: InboundEmailReceiptState.IGNORED,
    disposition: InboundEmailDisposition.UNSUPPORTED
  });
}

async function finalizeReceipt(
  dependencies: InboundWebhookDependencies,
  input: FinalizeInput
): Promise<"updated" | "inactive"> {
  return dependencies.runTransaction(async (db) => {
    const current = await currentOwnedMailbox(db, input.mailbox);
    if (
      !current ||
      current.status !== InboundMailboxStatus.ACTIVE ||
      current.aliasLocalPart !== input.mailbox.aliasLocalPart
    ) {
      if (current) {
        await markInactiveReceipt(dependencies, db, input.receipt);
      }
      return "inactive";
    }

    if (input.candidate) {
      await dependencies.createDraft(db, {
        userId: input.mailbox.userId,
        mailboxId: input.mailbox.id,
        aliasLocalPart: input.mailbox.aliasLocalPart,
        receiptId: input.receipt.id,
        candidate: input.candidate,
        now: input.now
      });
    }

    const marked = await dependencies.markReceipt(db, {
      id: input.receipt.id,
      userId: input.receipt.userId,
      mailboxId: input.receipt.mailboxId,
      state: input.state,
      disposition: input.disposition
    });
    if (!marked) throw new Error("Inbound receipt transition failed.");

    const updated = await db.inboundMailbox.updateMany({
      where: {
        id: input.mailbox.id,
        userId: input.mailbox.userId,
        aliasLocalPart: input.mailbox.aliasLocalPart,
        status: InboundMailboxStatus.ACTIVE
      },
      data: {
        lastDisposition: input.disposition,
        lastReceivedAt: input.now
      }
    });
    if (updated.count !== 1) {
      throw new Error("Inbound mailbox transition failed.");
    }

    await db.activityLog.create({
      data: {
        userId: input.mailbox.userId,
        action: "INBOUND_EMAIL_RECEIVED",
        entityType: "InboundEmail",
        entityId: null,
        metadata: { disposition: input.disposition }
      }
    });
    return "updated";
  });
}

async function updateOwnedDuplicateMailbox(
  dependencies: InboundWebhookDependencies,
  mailbox: ResolvedMailbox,
  now: Date
) {
  return dependencies.runTransaction(async (db) => {
    const current = await currentOwnedMailbox(db, mailbox);
    if (
      !current ||
      current.status !== InboundMailboxStatus.ACTIVE ||
      current.aliasLocalPart !== mailbox.aliasLocalPart
    ) {
      return;
    }

    const updated = await db.inboundMailbox.updateMany({
      where: {
        id: mailbox.id,
        userId: mailbox.userId,
        aliasLocalPart: mailbox.aliasLocalPart,
        status: InboundMailboxStatus.ACTIVE
      },
      data: {
        lastDisposition: InboundEmailDisposition.DUPLICATE,
        lastReceivedAt: now
      }
    });
    if (updated.count !== 1) {
      throw new Error("Inbound duplicate mailbox status update failed.");
    }
  });
}

async function cleanupAfterVerified(
  dependencies: InboundWebhookDependencies,
  now: Date
) {
  try {
    await dependencies.cleanup(now);
  } catch (error) {
    console.error("Inbound email retention cleanup failed.", {
      errorClass: safeErrorClass(error)
    });
  }
}

async function finishWithCleanup(
  dependencies: InboundWebhookDependencies,
  now: Date,
  webhookResult: InboundWebhookResult
) {
  await cleanupAfterVerified(dependencies, now);
  return webhookResult;
}

async function markRetryable(
  dependencies: InboundWebhookDependencies,
  mailbox: ResolvedMailbox,
  receipt: ClaimedReceipt,
  now: Date
) {
  try {
    return await finalizeReceipt(dependencies, {
      mailbox,
      receipt,
      now,
      state: InboundEmailReceiptState.RETRYABLE_FAILED,
      disposition: InboundEmailDisposition.PROVIDER_ERROR
    });
  } catch {
    return "failed" as const;
  }
}

async function retryAfterFailure(
  dependencies: InboundWebhookDependencies,
  mailbox: ResolvedMailbox,
  receipt: ClaimedReceipt,
  now: Date
) {
  const marked = await markRetryable(dependencies, mailbox, receipt, now);
  return marked === "inactive" ? result(200, "IGNORED") : result(503, "RETRY");
}

export function createInboundWebhookDependencies(
  provider: InboundEmailProvider
): InboundWebhookDependencies {
  return {
    provider,
    now: () => new Date(),
    resolveMailbox: findActiveMailboxForRecipient,
    claimReceipt: claimInboundEmailReceipt,
    checkAliasRateLimit: checkInboundEmailAlias,
    parseMessage: parseSyntheticInboundMessage,
    createDraft: createEmailDraftFromCandidate,
    markReceipt: markInboundReceipt,
    cleanup: cleanupExpiredInboundEmailData,
    runTransaction: (operation) => prisma.$transaction(operation),
    timeoutMs: DEFAULT_RETRIEVAL_TIMEOUT_MS
  };
}

export async function handleInboundEmailWebhook(
  input: { rawBody: string; headers: Headers; domain: string },
  dependencies: InboundWebhookDependencies
): Promise<InboundWebhookResult> {
  let notification: InboundNotification;
  try {
    notification = dependencies.provider.verifyNotification(
      input.rawBody,
      input.headers
    );
  } catch (error) {
    const code = safeErrorCode(error);
    if (code === "UNSUPPORTED_EVENT") return result(200, "IGNORED");
    if (code === "INVALID_SIGNATURE") return result(401, "INVALID");
    if (code === "INVALID_NOTIFICATION") return result(400, "INVALID");
    return result(503, "RETRY");
  }

  if (notification.recipients.length !== 1) {
    return result(400, "INVALID");
  }

  const recipient = notification.recipients[0];
  if (!parseInboundEmailRecipient(recipient, input.domain)) {
    return result(400, "INVALID");
  }

  const receivedAt = dependencies.now();
  let mailbox: ResolvedMailbox | null;
  try {
    mailbox = await dependencies.resolveMailbox(
      prisma,
      recipient,
      input.domain
    );
  } catch {
    return result(503, "RETRY");
  }
  if (!mailbox) {
    return result(200, "IGNORED");
  }

  let claim: InboundReceiptClaim;
  try {
    claim = await dependencies.claimReceipt({
      provider: InboundMailboxProvider.RESEND,
      userId: mailbox.userId,
      mailboxId: mailbox.id,
      eventId: notification.eventId,
      messageId: notification.messageId,
      now: receivedAt
    });
  } catch {
    return result(503, "RETRY");
  }

  if (
    claim.receipt.userId !== mailbox.userId ||
    claim.receipt.mailboxId !== mailbox.id
  ) {
    return result(200, "IGNORED");
  }

  if (claim.kind === "processing") {
    return result(503, "RETRY");
  }

  if (claim.kind === "duplicate") {
    try {
      await updateOwnedDuplicateMailbox(dependencies, mailbox, receivedAt);
    } catch (error) {
      console.error("Inbound email duplicate status update failed.", {
        errorClass: safeErrorClass(error)
      });
    }
    return finishWithCleanup(
      dependencies,
      receivedAt,
      result(200, "DUPLICATE")
    );
  }

  let limitDecision: Awaited<ReturnType<typeof checkInboundEmailAlias>>;
  try {
    limitDecision = await dependencies.checkAliasRateLimit(
      mailbox.aliasLocalPart
    );
  } catch {
    limitDecision = {
      allowed: false,
      unavailable: true,
      limit: 0,
      remaining: 0,
      retryAfterSeconds: 0
    };
  }
  if (limitDecision.unavailable) {
    return finishWithCleanup(
      dependencies,
      receivedAt,
      await retryAfterFailure(
        dependencies,
        mailbox,
        claim.receipt,
        receivedAt
      )
    );
  }
  if (!limitDecision.allowed) {
    try {
      await finalizeReceipt(dependencies, {
        mailbox,
        receipt: claim.receipt,
        now: receivedAt,
        state: InboundEmailReceiptState.IGNORED,
        disposition: InboundEmailDisposition.RATE_LIMITED
      });
      return finishWithCleanup(
        dependencies,
        receivedAt,
        result(200, "IGNORED")
      );
    } catch {
      return finishWithCleanup(
        dependencies,
        receivedAt,
        await retryAfterFailure(
          dependencies,
          mailbox,
          claim.receipt,
          receivedAt
        )
      );
    }
  }

  const retrieved = await retrieveWithTimeout(
    dependencies.provider,
    notification.messageId,
    dependencies.timeoutMs
  );
  if (retrieved.kind !== "message") {
    if (
      retrieved.kind === "error" &&
      safeErrorCode(retrieved.error) === "PAYLOAD_TOO_LARGE"
    ) {
      try {
        const finalized = await finalizeReceipt(dependencies, {
          mailbox,
          receipt: claim.receipt,
          now: receivedAt,
          state: InboundEmailReceiptState.TERMINAL_FAILED,
          disposition: InboundEmailDisposition.OVERSIZED
        });
        return finishWithCleanup(
          dependencies,
          receivedAt,
          result(200, finalized === "inactive" ? "IGNORED" : "OVERSIZED")
        );
      } catch {
        return finishWithCleanup(
          dependencies,
          receivedAt,
          await retryAfterFailure(
            dependencies,
            mailbox,
            claim.receipt,
            receivedAt
          )
        );
      }
    }
    return finishWithCleanup(
      dependencies,
      receivedAt,
      await retryAfterFailure(
        dependencies,
        mailbox,
        claim.receipt,
        receivedAt
      )
    );
  }

  if (contentBytes(retrieved.message) > MAX_INBOUND_CONTENT_BYTES) {
    try {
      const finalized = await finalizeReceipt(dependencies, {
        mailbox,
        receipt: claim.receipt,
        now: receivedAt,
        state: InboundEmailReceiptState.TERMINAL_FAILED,
        disposition: InboundEmailDisposition.OVERSIZED
      });
      return finishWithCleanup(
        dependencies,
        receivedAt,
        result(200, finalized === "inactive" ? "IGNORED" : "OVERSIZED")
      );
    } catch {
      return finishWithCleanup(
        dependencies,
        receivedAt,
        await retryAfterFailure(
          dependencies,
          mailbox,
          claim.receipt,
          receivedAt
        )
      );
    }
  }

  let parsed: ReturnType<typeof parseSyntheticInboundMessage>;
  try {
    parsed = dependencies.parseMessage(retrieved.message);
  } catch {
    try {
      await finalizeReceipt(dependencies, {
        mailbox,
        receipt: claim.receipt,
        now: receivedAt,
        state: InboundEmailReceiptState.TERMINAL_FAILED,
        disposition: InboundEmailDisposition.PARSER_ERROR
      });
      return finishWithCleanup(dependencies, receivedAt, result(200, "IGNORED"));
    } catch {
      return finishWithCleanup(
        dependencies,
        receivedAt,
        await retryAfterFailure(
          dependencies,
          mailbox,
          claim.receipt,
          receivedAt
        )
      );
    }
  }

  if (parsed.kind === "unsupported") {
    try {
      await finalizeReceipt(dependencies, {
        mailbox,
        receipt: claim.receipt,
        now: receivedAt,
        state: InboundEmailReceiptState.IGNORED,
        disposition: InboundEmailDisposition.UNSUPPORTED
      });
      return finishWithCleanup(dependencies, receivedAt, result(200, "IGNORED"));
    } catch {
      return finishWithCleanup(
        dependencies,
        receivedAt,
        await retryAfterFailure(
          dependencies,
          mailbox,
          claim.receipt,
          receivedAt
        )
      );
    }
  }

  try {
    const finalized = await finalizeReceipt(dependencies, {
      mailbox,
      receipt: claim.receipt,
      now: receivedAt,
      state: InboundEmailReceiptState.PROCESSED,
      disposition: InboundEmailDisposition.TEST_DRAFT_CREATED,
      candidate: parsed.candidate
    });
    return finishWithCleanup(
      dependencies,
      receivedAt,
      result(200, finalized === "inactive" ? "IGNORED" : "ACCEPTED")
    );
  } catch {
    return finishWithCleanup(
      dependencies,
      receivedAt,
      await retryAfterFailure(
        dependencies,
        mailbox,
        claim.receipt,
        receivedAt
      )
    );
  }
}
