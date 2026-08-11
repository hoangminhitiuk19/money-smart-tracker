import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleInboundEmailWebhook,
  type InboundWebhookDependencies
} from "@/lib/inbound-email/webhook";
import type {
  EmailDraftCandidate,
  InboundMessage,
  InboundNotification
} from "@/lib/inbound-email/types";

const now = new Date("2026-08-11T04:00:00.000Z");
const notification: InboundNotification = {
  eventId: "synthetic-event-7d22f4c9",
  messageId: "29d7e94a-4e5a-49d6-aeac-d01548b26914",
  recipients: ["opaque-recipient@inbound.audit.invalid"],
  occurredAt: new Date("2026-08-11T03:59:00.000Z")
};
const message: InboundMessage = {
  text: [
    "MONEY SMART TRACKER TEST",
    "Amount: 125000",
    "Currency: VND",
    "Date: 2026-08-10",
    "Merchant: Synthetic Cafe 7d22f4c9"
  ].join("\n"),
  html: null,
  attachmentCount: 0
};
const candidate: EmailDraftCandidate = {
  type: "EXPENSE",
  amountText: "125000",
  currency: "VND",
  transactionDateText: "2026-08-10",
  title: "Synthetic Cafe 7d22f4c9",
  description: "Synthetic inbound-email test data.",
  confidence: 100
};
const mailbox = {
  id: "mailbox-synthetic-7d22f4c9",
  userId: "user-synthetic-7d22f4c9",
  aliasLocalPart: "opaque-recipient",
  status: "ACTIVE" as const
};
type CurrentMailbox = Omit<typeof mailbox, "status"> & {
  status: "ACTIVE" | "DISABLED";
};
const receipt = {
  id: "receipt-synthetic-7d22f4c9",
  userId: mailbox.userId,
  mailboxId: mailbox.id
};

function rateLimit(allowed = true, unavailable = false) {
  return {
    allowed,
    unavailable,
    limit: 60,
    remaining: allowed ? 59 : 0,
    retryAfterSeconds: 60
  };
}

function testHarness(options: {
  notification?: InboundNotification;
  mailbox?: typeof mailbox | null;
  currentMailbox?: CurrentMailbox | null;
  receiptKind?: "claimed" | "duplicate";
  receipt?: typeof receipt;
  rateLimit?: ReturnType<typeof rateLimit>;
  message?: InboundMessage;
  parse?: { kind: "candidate"; candidate: EmailDraftCandidate } | { kind: "unsupported"; code: "UNSUPPORTED" };
  timeoutMs?: number;
} = {}) {
  const calls: string[] = [];
  const currentMailbox = options.currentMailbox === undefined
    ? mailbox
    : options.currentMailbox;
  const mailboxUpdate = vi.fn(async () => ({ count: 1 }));
  const activityCreate = vi.fn(async () => ({ id: "activity-synthetic" }));
  const queryRaw = vi.fn(async () => currentMailbox ? [{ id: currentMailbox.id }] : []);
  const db = {
    $queryRaw: queryRaw,
    inboundMailbox: {
      findUnique: vi.fn(async () => currentMailbox),
      updateMany: mailboxUpdate
    },
    activityLog: { create: activityCreate }
  } as unknown as Prisma.TransactionClient;
  const verifyNotification = vi.fn(() => {
    calls.push("verify");
    return options.notification ?? notification;
  });
  const retrieveMessage = vi.fn(async (messageId: string, signal: AbortSignal) => {
    void messageId;
    void signal;
    calls.push("retrieve");
    return options.message ?? message;
  });
  const resolveMailbox = vi.fn(async () => {
    calls.push("resolve");
    return options.mailbox === undefined ? mailbox : options.mailbox;
  });
  const claimReceipt = vi.fn(async () => {
    calls.push("claim");
    return {
      kind: options.receiptKind ?? "claimed",
      receipt: options.receipt ?? receipt
    };
  });
  const checkAliasRateLimit = vi.fn(async () => {
    calls.push("rate-limit");
    return options.rateLimit ?? rateLimit();
  });
  const parseMessage = vi.fn(() => {
    calls.push("parse");
    return options.parse ?? { kind: "candidate" as const, candidate };
  });
  const createDraft = vi.fn(async () => {
    calls.push("create-draft");
    return {
      draftId: "draft-synthetic-7d22f4c9",
      captureKey: "a2cc9772-5794-4c79-aa32-4b9a47d24479",
      created: true
    };
  });
  const markReceipt = vi.fn(async () => {
    calls.push("complete");
    return true;
  });
  const cleanup = vi.fn(async () => ({ receiptsDeleted: 0, draftsDeleted: 0 }));
  const runTransaction = vi.fn(async <T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>) => operation(db));
  const dependencies = {
    provider: { verifyNotification, retrieveMessage },
    now: () => now,
    resolveMailbox,
    claimReceipt,
    checkAliasRateLimit,
    parseMessage,
    createDraft,
    markReceipt,
    cleanup,
    runTransaction,
    timeoutMs: options.timeoutMs ?? 50
  } as unknown as InboundWebhookDependencies;

  return {
    calls,
    dependencies,
    spies: {
      activityCreate,
      claimReceipt,
      cleanup,
      createDraft,
      markReceipt,
      mailboxUpdate,
      parseMessage,
      resolveMailbox,
      retrieveMessage,
      runTransaction,
      verifyNotification
    }
  };
}

const input = {
  rawBody: "synthetic-raw-webhook-7d22f4c9",
  headers: new Headers({ "x-synthetic-signature": "present" }),
  domain: "inbound.audit.invalid"
};

describe("signed inbound-email webhook orchestration", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("stops after untouched signature verification fails", async () => {
    const harness = testHarness();
    harness.spies.verifyNotification.mockImplementationOnce(() => {
      harness.calls.push("verify");
      throw { code: "INVALID_SIGNATURE" };
    });

    await expect(handleInboundEmailWebhook(input, harness.dependencies)).resolves.toEqual({
      status: 401,
      code: "INVALID"
    });
    expect(harness.calls).toEqual(["verify"]);
    expect(harness.spies.verifyNotification).toHaveBeenCalledWith(
      input.rawBody,
      input.headers
    );
  });

  it("acknowledges an unsupported signed event before lookup or retrieval", async () => {
    const harness = testHarness();
    harness.spies.verifyNotification.mockImplementationOnce(() => {
      harness.calls.push("verify");
      throw { code: "UNSUPPORTED_EVENT" };
    });

    await expect(handleInboundEmailWebhook(input, harness.dependencies)).resolves.toEqual({
      status: 200,
      code: "IGNORED"
    });
    expect(harness.calls).toEqual(["verify"]);
  });

  it("maps a malformed signed notification to a data-free invalid result", async () => {
    const harness = testHarness();
    harness.spies.verifyNotification.mockImplementationOnce(() => {
      harness.calls.push("verify");
      throw { code: "INVALID_NOTIFICATION" };
    });

    await expect(handleInboundEmailWebhook(input, harness.dependencies)).resolves.toEqual({
      status: 400,
      code: "INVALID"
    });
    expect(harness.calls).toEqual(["verify"]);
  });

  it("requires exactly one signed recipient before alias lookup", async () => {
    const harness = testHarness({
      notification: {
        ...notification,
        recipients: [
          "opaque-one@inbound.audit.invalid",
          "opaque-two@inbound.audit.invalid"
        ]
      }
    });

    await expect(handleInboundEmailWebhook(input, harness.dependencies)).resolves.toEqual({
      status: 400,
      code: "INVALID"
    });
    expect(harness.calls).toEqual(["verify"]);
  });

  it("acknowledges an unknown alias without a claim", async () => {
    const harness = testHarness({ mailbox: null });

    await expect(handleInboundEmailWebhook(input, harness.dependencies)).resolves.toEqual({
      status: 200,
      code: "IGNORED"
    });
    expect(harness.calls).toEqual(["verify", "resolve"]);
    expect(harness.spies.claimReceipt).not.toHaveBeenCalled();
    expect(harness.spies.cleanup).not.toHaveBeenCalled();
  });

  it("returns retry without cleanup when mailbox resolution fails before claim", async () => {
    const harness = testHarness();
    harness.spies.resolveMailbox.mockImplementationOnce(async () => {
      harness.calls.push("resolve");
      throw new Error("synthetic resolve failure 7d22f4c9");
    });

    await expect(handleInboundEmailWebhook(input, harness.dependencies)).resolves.toEqual({
      status: 503,
      code: "RETRY"
    });
    expect(harness.calls).toEqual(["verify", "resolve"]);
    expect(harness.spies.cleanup).not.toHaveBeenCalled();
  });

  it("returns retry without cleanup when durable claim fails", async () => {
    const harness = testHarness();
    harness.spies.claimReceipt.mockImplementationOnce(async () => {
      harness.calls.push("claim");
      throw new Error("synthetic claim failure 7d22f4c9");
    });

    await expect(handleInboundEmailWebhook(input, harness.dependencies)).resolves.toEqual({
      status: 503,
      code: "RETRY"
    });
    expect(harness.calls).toEqual(["verify", "resolve", "claim"]);
    expect(harness.spies.cleanup).not.toHaveBeenCalled();
  });

  it("keeps a cross-owner receipt collision opaque without cleanup", async () => {
    const harness = testHarness({
      receiptKind: "duplicate",
      receipt: {
        ...receipt,
        userId: "different-owner-7d22f4c9",
        mailboxId: "different-mailbox-7d22f4c9"
      }
    });

    await expect(handleInboundEmailWebhook(input, harness.dependencies)).resolves.toEqual({
      status: 200,
      code: "IGNORED"
    });
    expect(harness.calls).toEqual(["verify", "resolve", "claim"]);
    expect(harness.spies.runTransaction).not.toHaveBeenCalled();
    expect(harness.spies.cleanup).not.toHaveBeenCalled();
  });

  it("does not retrieve or parse after the durable alias limit rejects processing", async () => {
    const harness = testHarness({ rateLimit: rateLimit(false) });

    await expect(handleInboundEmailWebhook(input, harness.dependencies)).resolves.toEqual({
      status: 200,
      code: "IGNORED"
    });
    expect(harness.calls).toEqual([
      "verify",
      "resolve",
      "claim",
      "rate-limit",
      "complete"
    ]);
    expect(harness.spies.retrieveMessage).not.toHaveBeenCalled();
    expect(harness.spies.parseMessage).not.toHaveBeenCalled();
    expect(harness.spies.markReceipt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ state: "IGNORED", disposition: "RATE_LIMITED" })
    );
  });

  it("executes the valid path in the security-critical order and writes safe activity", async () => {
    const harness = testHarness();

    await expect(handleInboundEmailWebhook(input, harness.dependencies)).resolves.toEqual({
      status: 200,
      code: "ACCEPTED"
    });
    expect(harness.calls).toEqual([
      "verify",
      "resolve",
      "claim",
      "rate-limit",
      "retrieve",
      "parse",
      "create-draft",
      "complete"
    ]);
    expect(harness.spies.activityCreate).toHaveBeenCalledWith({
      data: {
        userId: mailbox.userId,
        action: "INBOUND_EMAIL_RECEIVED",
        entityType: "InboundEmail",
        entityId: null,
        metadata: { disposition: "TEST_DRAFT_CREATED" }
      }
    });
    expect(harness.spies.mailboxUpdate).toHaveBeenCalledWith({
      where: {
        id: mailbox.id,
        userId: mailbox.userId,
        aliasLocalPart: mailbox.aliasLocalPart,
        status: "ACTIVE"
      },
      data: {
        lastDisposition: "TEST_DRAFT_CREATED",
        lastReceivedAt: now
      }
    });
  });

  it("does not overwrite a duplicate receipt's original disposition", async () => {
    const harness = testHarness({ receiptKind: "duplicate" });

    await expect(handleInboundEmailWebhook(input, harness.dependencies)).resolves.toEqual({
      status: 200,
      code: "DUPLICATE"
    });
    expect(harness.calls).toEqual(["verify", "resolve", "claim"]);
    expect(harness.spies.markReceipt).not.toHaveBeenCalled();
    expect(harness.spies.retrieveMessage).not.toHaveBeenCalled();
    expect(harness.spies.activityCreate).not.toHaveBeenCalled();
    expect(harness.spies.mailboxUpdate).toHaveBeenCalledWith({
      where: {
        id: mailbox.id,
        userId: mailbox.userId,
        aliasLocalPart: mailbox.aliasLocalPart,
        status: "ACTIVE"
      },
      data: { lastDisposition: "DUPLICATE", lastReceivedAt: now }
    });
  });

  it("blocks draft creation when the alias rotated during retrieval", async () => {
    const harness = testHarness({
      currentMailbox: { ...mailbox, aliasLocalPart: "rotated-opaque-recipient" }
    });

    await expect(handleInboundEmailWebhook(input, harness.dependencies)).resolves.toEqual({
      status: 200,
      code: "IGNORED"
    });
    expect(harness.spies.createDraft).not.toHaveBeenCalled();
    expect(harness.spies.markReceipt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ state: "IGNORED", disposition: "UNSUPPORTED" })
    );
    expect(harness.spies.mailboxUpdate).not.toHaveBeenCalled();
    expect(harness.spies.activityCreate).not.toHaveBeenCalled();
  });

  it("blocks draft creation when the mailbox was disabled during retrieval", async () => {
    const harness = testHarness({
      currentMailbox: {
        ...mailbox,
        status: "DISABLED"
      }
    });

    await expect(handleInboundEmailWebhook(input, harness.dependencies)).resolves.toEqual({
      status: 200,
      code: "IGNORED"
    });
    expect(harness.spies.createDraft).not.toHaveBeenCalled();
    expect(harness.spies.markReceipt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ state: "IGNORED", disposition: "UNSUPPORTED" })
    );
    expect(harness.spies.mailboxUpdate).not.toHaveBeenCalled();
    expect(harness.spies.activityCreate).not.toHaveBeenCalled();
  });

  it("acknowledges generically when rotation wins before an oversize terminal update", async () => {
    const harness = testHarness({
      currentMailbox: { ...mailbox, aliasLocalPart: "rotated-before-oversize" },
      message: { text: "x".repeat(1_000_001), html: null, attachmentCount: 0 }
    });

    await expect(handleInboundEmailWebhook(input, harness.dependencies)).resolves.toEqual({
      status: 200,
      code: "IGNORED"
    });
    expect(harness.spies.markReceipt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ state: "IGNORED", disposition: "UNSUPPORTED" })
    );
    expect(harness.spies.mailboxUpdate).not.toHaveBeenCalled();
    expect(harness.spies.activityCreate).not.toHaveBeenCalled();
  });

  it("aborts timed-out retrieval and leaves a retryable receipt", async () => {
    const harness = testHarness({ timeoutMs: 5 });
    let observedSignal: AbortSignal | undefined;
    harness.spies.retrieveMessage.mockImplementationOnce(async (_messageId, signal) => {
      harness.calls.push("retrieve");
      observedSignal = signal;
      await new Promise<void>(() => undefined);
      return message;
    });

    await expect(handleInboundEmailWebhook(input, harness.dependencies)).resolves.toEqual({
      status: 503,
      code: "RETRY"
    });
    expect(observedSignal?.aborted).toBe(true);
    expect(harness.spies.parseMessage).not.toHaveBeenCalled();
    expect(harness.spies.markReceipt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        state: "RETRYABLE_FAILED",
        disposition: "PROVIDER_ERROR"
      })
    );
  });

  it("returns retry when the rate-limit store is unavailable", async () => {
    const harness = testHarness({ rateLimit: rateLimit(false, true) });

    await expect(handleInboundEmailWebhook(input, harness.dependencies)).resolves.toEqual({
      status: 503,
      code: "RETRY"
    });
    expect(harness.spies.retrieveMessage).not.toHaveBeenCalled();
    expect(harness.spies.markReceipt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ state: "RETRYABLE_FAILED" })
    );
  });

  it("best-effort marks a receipt retryable after a database transaction failure", async () => {
    const harness = testHarness();
    const originalImplementation = harness.spies.runTransaction.getMockImplementation();
    harness.spies.runTransaction
      .mockRejectedValueOnce(new Error("synthetic database detail 7d22f4c9"))
      .mockImplementation(originalImplementation!);

    await expect(handleInboundEmailWebhook(input, harness.dependencies)).resolves.toEqual({
      status: 503,
      code: "RETRY"
    });
    expect(harness.spies.runTransaction).toHaveBeenCalledTimes(2);
    expect(harness.spies.markReceipt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ state: "RETRYABLE_FAILED" })
    );
  });

  it("stores only an unsupported disposition for an unrecognized body", async () => {
    const harness = testHarness({
      parse: { kind: "unsupported", code: "UNSUPPORTED" }
    });

    await expect(handleInboundEmailWebhook(input, harness.dependencies)).resolves.toEqual({
      status: 200,
      code: "IGNORED"
    });
    expect(harness.spies.createDraft).not.toHaveBeenCalled();
    expect(harness.spies.markReceipt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ state: "IGNORED", disposition: "UNSUPPORTED" })
    );
  });

  it("rejects combined content that exceeds the application bound before parsing", async () => {
    const harness = testHarness({
      message: { text: "x".repeat(1_000_001), html: null, attachmentCount: 0 }
    });

    await expect(handleInboundEmailWebhook(input, harness.dependencies)).resolves.toEqual({
      status: 200,
      code: "OVERSIZED"
    });
    expect(harness.spies.parseMessage).not.toHaveBeenCalled();
    expect(harness.spies.markReceipt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        state: "TERMINAL_FAILED",
        disposition: "OVERSIZED"
      })
    );
  });

  it("maps provider-declared content oversize to a terminal generic outcome", async () => {
    const harness = testHarness();
    harness.spies.retrieveMessage.mockImplementationOnce(async () => {
      harness.calls.push("retrieve");
      throw { code: "PAYLOAD_TOO_LARGE" };
    });

    await expect(handleInboundEmailWebhook(input, harness.dependencies)).resolves.toEqual({
      status: 200,
      code: "OVERSIZED"
    });
    expect(harness.spies.markReceipt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ disposition: "OVERSIZED" })
    );
  });

  it("maps parser exceptions to a bounded terminal disposition", async () => {
    const harness = testHarness();
    harness.spies.parseMessage.mockImplementationOnce(() => {
      harness.calls.push("parse");
      throw new Error("synthetic parser private detail 7d22f4c9");
    });

    await expect(handleInboundEmailWebhook(input, harness.dependencies)).resolves.toEqual({
      status: 200,
      code: "IGNORED"
    });
    expect(harness.spies.markReceipt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        state: "TERMINAL_FAILED",
        disposition: "PARSER_ERROR"
      })
    );
  });

  it("keeps cleanup failure non-fatal and logs only a fixed class", async () => {
    class SyntheticCleanupFailure extends Error {}
    const harness = testHarness();
    harness.spies.cleanup.mockRejectedValueOnce(
      new SyntheticCleanupFailure("private cleanup detail 7d22f4c9")
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(handleInboundEmailWebhook(input, harness.dependencies)).resolves.toEqual({
      status: 200,
      code: "ACCEPTED"
    });
    expect(consoleError).toHaveBeenCalledWith(
      "Inbound email retention cleanup failed.",
      { errorClass: "SyntheticCleanupFailure" }
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      "private cleanup detail"
    );
  });
});
