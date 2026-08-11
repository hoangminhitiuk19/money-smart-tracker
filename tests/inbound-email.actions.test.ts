import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInboundMailbox,
  deletePendingInboundEmailDrafts,
  disableInboundMailbox,
  disconnectInboundMailbox,
  enableInboundMailbox,
  getInboundEmailSetup,
  rotateInboundMailbox
} from "@/lib/actions/inbound-email";
import { prisma } from "@/lib/prisma";
import {
  checkAuthenticatedMutation,
  RATE_LIMIT_MESSAGE
} from "@/lib/security/rate-limit";

const user = {
  id: "user-1",
  email: "person@example.test",
  name: "Synthetic Person"
};
const aliasLocalPart = `m_${"a".repeat(40)}`;
const domain = "inbound.example.test";
const captureKey = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-08-10T03:00:00.000Z");

const inboundActionMocks = vi.hoisted(() => ({
  activityCreate: vi.fn(),
  checkMutation: vi.fn(),
  cleanup: vi.fn(),
  getConfig: vi.fn(),
  requireAuth: vi.fn(),
  rootDraftFindFirst: vi.fn(),
  rootMailboxFindUnique: vi.fn(),
  transaction: vi.fn(),
  txDraftDeleteMany: vi.fn(),
  txDraftFindFirst: vi.fn(),
  txMailboxCreate: vi.fn(),
  txMailboxDeleteMany: vi.fn(),
  txMailboxFindUnique: vi.fn(),
  txMailboxUpdateMany: vi.fn(),
  txQueryRaw: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireAuth: inboundActionMocks.requireAuth
}));

vi.mock("@/lib/env", () => ({
  getInboundEmailConfig: inboundActionMocks.getConfig
}));

vi.mock("@/lib/security/rate-limit", () => ({
  checkAuthenticatedMutation: inboundActionMocks.checkMutation,
  RATE_LIMIT_MESSAGE: "Too many requests. Please try again shortly."
}));

vi.mock("@/lib/transaction-drafts/retention", () => ({
  cleanupExpiredTransactionDrafts: inboundActionMocks.cleanup
}));

vi.mock("@/lib/prisma", () => {
  const transactionClient = {
    $queryRaw: inboundActionMocks.txQueryRaw,
    activityLog: { create: inboundActionMocks.activityCreate },
    inboundMailbox: {
      create: inboundActionMocks.txMailboxCreate,
      deleteMany: inboundActionMocks.txMailboxDeleteMany,
      findUnique: inboundActionMocks.txMailboxFindUnique,
      updateMany: inboundActionMocks.txMailboxUpdateMany
    },
    transactionDraft: {
      deleteMany: inboundActionMocks.txDraftDeleteMany,
      findFirst: inboundActionMocks.txDraftFindFirst
    }
  };

  return {
    prisma: {
      $transaction: inboundActionMocks.transaction,
      inboundMailbox: {
        findUnique: inboundActionMocks.rootMailboxFindUnique,
        updateMany: inboundActionMocks.txMailboxUpdateMany
      },
      transactionDraft: {
        findFirst: inboundActionMocks.rootDraftFindFirst
      }
    },
    transactionClient
  };
});

function mailbox(overrides: Record<string, unknown> = {}) {
  return {
    id: "mailbox-1",
    userId: "user-1",
    provider: "RESEND",
    aliasLocalPart,
    status: "ACTIVE",
    lastDisposition: "TEST_DRAFT_CREATED",
    lastReceivedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function uniqueConflict(
  target?: string[],
  modelName = "InboundMailbox"
) {
  return new Prisma.PrismaClientKnownRequestError("Synthetic unique conflict", {
    code: "P2002",
    clientVersion: "6.19.0",
    ...(target ? { meta: { modelName, target } } : {})
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  const transactionClient = {
    $queryRaw: inboundActionMocks.txQueryRaw,
    activityLog: { create: inboundActionMocks.activityCreate },
    inboundMailbox: {
      create: inboundActionMocks.txMailboxCreate,
      deleteMany: inboundActionMocks.txMailboxDeleteMany,
      findUnique: inboundActionMocks.txMailboxFindUnique,
      updateMany: inboundActionMocks.txMailboxUpdateMany
    },
    transactionDraft: {
      deleteMany: inboundActionMocks.txDraftDeleteMany,
      findFirst: inboundActionMocks.txDraftFindFirst
    }
  };
  inboundActionMocks.requireAuth.mockResolvedValue(user);
  inboundActionMocks.checkMutation.mockResolvedValue({
    allowed: true,
    unavailable: false,
    limit: 60,
    remaining: 59,
    retryAfterSeconds: 60
  });
  inboundActionMocks.getConfig.mockReturnValue({
    apiKey: "synthetic-api-key",
    webhookSecret: "synthetic-webhook-secret",
    domain
  });
  inboundActionMocks.cleanup.mockResolvedValue(0);
  inboundActionMocks.rootMailboxFindUnique.mockResolvedValue(null);
  inboundActionMocks.rootDraftFindFirst.mockResolvedValue(null);
  inboundActionMocks.txMailboxFindUnique.mockResolvedValue(null);
  inboundActionMocks.txQueryRaw.mockResolvedValue([{ id: "mailbox-1" }]);
  inboundActionMocks.txMailboxCreate.mockImplementation(({ data }) =>
    Promise.resolve(mailbox({ aliasLocalPart: data.aliasLocalPart }))
  );
  inboundActionMocks.txMailboxUpdateMany.mockResolvedValue({ count: 1 });
  inboundActionMocks.txMailboxDeleteMany.mockResolvedValue({ count: 1 });
  inboundActionMocks.txDraftDeleteMany.mockResolvedValue({ count: 0 });
  inboundActionMocks.txDraftFindFirst.mockResolvedValue(null);
  inboundActionMocks.activityCreate.mockResolvedValue({});
  inboundActionMocks.transaction.mockImplementation((callback) =>
    callback(transactionClient)
  );
});

describe("inbound email setup privacy", () => {
  it("returns a configuration-safe unavailable view and scopes its read", async () => {
    inboundActionMocks.getConfig.mockReturnValue(null);

    await expect(getInboundEmailSetup()).resolves.toEqual({
      ok: true,
      setup: { configured: false, mailbox: null }
    });

    expect(prisma.inboundMailbox.findUnique).toHaveBeenCalledWith({
      where: { userId: "user-1" }
    });
    expect(inboundActionMocks.cleanup).toHaveBeenCalledTimes(1);
  });

  it("exposes only the safe mailbox view and newest owned editable email capture", async () => {
    inboundActionMocks.rootMailboxFindUnique.mockResolvedValue(mailbox());
    inboundActionMocks.rootDraftFindFirst.mockResolvedValue({ captureKey });

    const result = await getInboundEmailSetup();

    expect(result).toEqual({
      ok: true,
      setup: {
        configured: true,
        mailbox: {
          address: `${aliasLocalPart}@${domain}`,
          status: "ACTIVE",
          lastDisposition: "TEST_DRAFT_CREATED",
          lastReceivedAt: "2026-08-10T03:00:00.000Z",
          reviewCaptureKey: captureKey
        }
      }
    });
    expect(prisma.transactionDraft.findFirst).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        origin: "EMAIL",
        status: { in: ["NEEDS_REVIEW", "READY"] }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { captureKey: true }
    });
    expect(JSON.stringify(result)).not.toContain("mailbox-1");
    expect(JSON.stringify(result)).not.toContain("RESEND");
  });

  it("withholds the address but keeps privacy controls available without configuration", async () => {
    inboundActionMocks.getConfig.mockReturnValue(null);
    inboundActionMocks.rootMailboxFindUnique.mockResolvedValue(mailbox());

    await expect(getInboundEmailSetup()).resolves.toMatchObject({
      ok: true,
      setup: { configured: false, mailbox: { address: null } }
    });
  });
});

describe("inbound mailbox creation", () => {
  it("requires complete configuration without starting a write", async () => {
    inboundActionMocks.getConfig.mockReturnValue(null);

    await expect(createInboundMailbox()).resolves.toEqual({
      ok: false,
      error: "Inbound email testing is unavailable."
    });
    expect(checkAuthenticatedMutation).toHaveBeenCalledWith("user-1");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("creates an opaque owned alias and safe activity in one transaction", async () => {
    const result = await createInboundMailbox();

    expect(result).toMatchObject({
      ok: true,
      setup: {
        configured: true,
        mailbox: { status: "ACTIVE", reviewCaptureKey: null }
      }
    });
    expect(inboundActionMocks.txMailboxCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        aliasLocalPart: expect.stringMatching(/^m_[0-9a-f]{40}$/)
      }
    });
    const createData = inboundActionMocks.txMailboxCreate.mock.calls[0][0].data;
    expect(createData.aliasLocalPart).not.toContain(user.id);
    expect(createData.aliasLocalPart).not.toContain(user.email);
    expect(inboundActionMocks.activityCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        action: "INBOUND_EMAIL_CONNECTED",
        entityType: "InboundEmail",
        entityId: null
      }
    });
  });

  it("returns the owned mailbox when a concurrent create wins the user uniqueness race", async () => {
    inboundActionMocks.transaction.mockRejectedValueOnce(
      uniqueConflict(["userId"])
    );
    inboundActionMocks.rootMailboxFindUnique.mockResolvedValue(mailbox());

    await expect(createInboundMailbox()).resolves.toMatchObject({
      ok: true,
      setup: { mailbox: { status: "ACTIVE" } }
    });

    expect(inboundActionMocks.transaction).toHaveBeenCalledTimes(1);
    expect(inboundActionMocks.rootMailboxFindUnique).toHaveBeenCalledWith({
      where: { userId: "user-1" }
    });
  });

  it("stops after an initial alias collision and three retries", async () => {
    inboundActionMocks.txMailboxCreate.mockRejectedValue(
      uniqueConflict(["aliasLocalPart"])
    );
    inboundActionMocks.rootMailboxFindUnique.mockResolvedValue(null);

    await expect(createInboundMailbox()).resolves.toEqual({
      ok: false,
      error: "Unable to update inbound email settings."
    });

    expect(inboundActionMocks.txMailboxCreate).toHaveBeenCalledTimes(4);
    expect(inboundActionMocks.transaction).toHaveBeenCalledTimes(4);
  });

  it.each([
    ["targetless", uniqueConflict()],
    ["unrelated", uniqueConflict(["id"], "ActivityLog")]
  ])("refuses a %s P2002 without retry or recovery lookup", async (_kind, conflict) => {
    inboundActionMocks.transaction.mockRejectedValueOnce(conflict);

    const result = await createInboundMailbox();

    expect(result).toEqual({
      ok: false,
      error: "Unable to update inbound email settings."
    });
    expect(inboundActionMocks.transaction).toHaveBeenCalledTimes(1);
    expect(inboundActionMocks.rootMailboxFindUnique).not.toHaveBeenCalled();
    expect(inboundActionMocks.activityCreate).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("P2002");
  });
});

describe("owned inbound mailbox state changes", () => {
  it.each([
    ["rotate", rotateInboundMailbox, inboundActionMocks.txMailboxUpdateMany],
    ["enable", enableInboundMailbox, inboundActionMocks.txMailboxUpdateMany],
    ["disable", disableInboundMailbox, inboundActionMocks.txMailboxUpdateMany],
    [
      "delete pending",
      deletePendingInboundEmailDrafts,
      inboundActionMocks.txDraftDeleteMany
    ],
    ["disconnect", disconnectInboundMailbox, inboundActionMocks.txDraftDeleteMany]
  ])("locks the owned mailbox before %s lifecycle mutation", async (
    _label,
    action,
    guardedMutation
  ) => {
    let mailboxLocked = false;
    inboundActionMocks.txMailboxFindUnique.mockResolvedValue(mailbox());
    inboundActionMocks.txQueryRaw.mockImplementation(async () => {
      mailboxLocked = true;
      return [{ id: "mailbox-1" }];
    });
    guardedMutation.mockImplementation(async () => {
      if (!mailboxLocked) {
        throw new Error("mailbox mutation ran without its row lock");
      }
      return { count: 1 };
    });

    await expect(action()).resolves.toMatchObject({ ok: true });
  });

  it("rotates only the authenticated user's mailbox and logs no alias metadata", async () => {
    inboundActionMocks.txMailboxFindUnique.mockResolvedValue(mailbox());

    await expect(rotateInboundMailbox()).resolves.toMatchObject({
      ok: true,
      setup: { mailbox: { status: "ACTIVE" } }
    });

    expect(inboundActionMocks.txMailboxUpdateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", id: "mailbox-1" },
      data: {
        aliasLocalPart: expect.stringMatching(/^m_[0-9a-f]{40}$/),
        lastDisposition: null,
        lastReceivedAt: null
      }
    });
    expect(inboundActionMocks.activityCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        action: "INBOUND_EMAIL_ALIAS_ROTATED",
        entityType: "InboundEmail",
        entityId: null
      }
    });
  });

  it.each([
    [enableInboundMailbox, "ACTIVE", "INBOUND_EMAIL_ENABLED"],
    [disableInboundMailbox, "DISABLED", "INBOUND_EMAIL_DISABLED"]
  ] as const)("owns the mailbox when changing it to %s", async (action, status, activity) => {
    inboundActionMocks.txMailboxFindUnique.mockResolvedValue(mailbox());
    if (status === "DISABLED") {
      inboundActionMocks.getConfig.mockReturnValue(null);
    }

    await expect(action()).resolves.toMatchObject({
      ok: true,
      setup: { mailbox: { status } }
    });
    expect(prisma.inboundMailbox.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", id: "mailbox-1" },
      data: expect.objectContaining({ status })
    });
    expect(inboundActionMocks.activityCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        action: activity,
        entityType: "InboundEmail",
        entityId: null
      }
    });
  });

  it("enables an existing owned mailbox without configuration and withholds its address", async () => {
    inboundActionMocks.getConfig.mockReturnValue(null);
    inboundActionMocks.txMailboxFindUnique.mockResolvedValue(
      mailbox({ status: "DISABLED" })
    );

    await expect(enableInboundMailbox()).resolves.toMatchObject({
      ok: true,
      setup: {
        configured: false,
        mailbox: { address: null, status: "ACTIVE" }
      }
    });
    expect(inboundActionMocks.txMailboxUpdateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", id: "mailbox-1" },
      data: { status: "ACTIVE" }
    });
    expect(inboundActionMocks.activityCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        action: "INBOUND_EMAIL_ENABLED",
        entityType: "InboundEmail",
        entityId: null
      }
    });
  });
});

describe("inbound email privacy deletion", () => {
  it("deletes only owned editable email drafts and logs only the count", async () => {
    inboundActionMocks.txMailboxFindUnique.mockResolvedValue(mailbox());
    inboundActionMocks.txDraftDeleteMany.mockResolvedValue({ count: 2 });

    await expect(deletePendingInboundEmailDrafts()).resolves.toMatchObject({
      ok: true,
      deletedCount: 2,
      setup: { configured: true }
    });

    expect(inboundActionMocks.txDraftDeleteMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        origin: "EMAIL",
        status: { in: ["NEEDS_REVIEW", "READY"] }
      }
    });
    expect(inboundActionMocks.activityCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        action: "INBOUND_EMAIL_PENDING_DELETED",
        entityType: "InboundEmail",
        entityId: null,
        metadata: { deletedDraftCount: 2 }
      }
    });
  });

  it("deletes drafts before the owned mailbox when disconnecting without configuration", async () => {
    inboundActionMocks.getConfig.mockReturnValue(null);
    inboundActionMocks.txDraftDeleteMany.mockResolvedValue({ count: 1 });

    await expect(disconnectInboundMailbox()).resolves.toEqual({
      ok: true,
      deletedDraftCount: 1,
      disconnected: true
    });

    expect(inboundActionMocks.txDraftDeleteMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        origin: "EMAIL",
        status: { in: ["NEEDS_REVIEW", "READY"] }
      }
    });
    expect(inboundActionMocks.txMailboxDeleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" }
    });
    expect(
      inboundActionMocks.txDraftDeleteMany.mock.invocationCallOrder[0]
    ).toBeLessThan(
      inboundActionMocks.txMailboxDeleteMany.mock.invocationCallOrder[0]
    );
    expect(inboundActionMocks.activityCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        action: "INBOUND_EMAIL_DISCONNECTED",
        entityType: "InboundEmail",
        entityId: null,
        metadata: { deletedDraftCount: 1 }
      }
    });
  });
});

describe("inbound email mutation failures", () => {
  it.each([
    createInboundMailbox,
    rotateInboundMailbox,
    enableInboundMailbox,
    disableInboundMailbox,
    deletePendingInboundEmailDrafts,
    disconnectInboundMailbox
  ])("rate limits a mutation before its transaction", async (action) => {
    inboundActionMocks.checkMutation.mockResolvedValueOnce({
      allowed: false,
      unavailable: false,
      limit: 60,
      remaining: 0,
      retryAfterSeconds: 60
    });

    await expect(action()).resolves.toEqual({
      ok: false,
      error: RATE_LIMIT_MESSAGE
    });
    expect(inboundActionMocks.transaction).not.toHaveBeenCalled();
  });

  it("returns a generic error without reflecting sensitive database details", async () => {
    inboundActionMocks.transaction.mockRejectedValueOnce(
      new Error(`failure for ${aliasLocalPart}@${domain}`)
    );

    const result = await disableInboundMailbox();
    const serialized = JSON.stringify(result);

    expect(result).toEqual({
      ok: false,
      error: "Unable to update inbound email settings."
    });
    expect(serialized).not.toContain(aliasLocalPart);
    expect(serialized).not.toContain(domain);
  });
});
