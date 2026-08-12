import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimInboundEmailReceipt,
  findActiveMailboxForRecipient,
  hashInboundIdentifier,
  markInboundReceipt,
  parseInboundEmailRecipient
} from "@/lib/inbound-email/receipts";
import {
  INBOUND_PROCESSING_LEASE_MS,
  INBOUND_RECEIPT_RETENTION_MS
} from "@/lib/inbound-email/constants";

const { receiptCreate, receiptFindUnique, receiptUpdateMany } = vi.hoisted(() => ({
  receiptCreate: vi.fn(),
  receiptFindUnique: vi.fn(),
  receiptUpdateMany: vi.fn()
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    inboundEmailReceipt: {
      create: receiptCreate,
      findUnique: receiptFindUnique,
      updateMany: receiptUpdateMany
    }
  }
}));

function opaque(prefix: string) {
  return `${prefix}-${randomBytes(12).toString("hex")}`;
}

function expectedInboundHash(provider: string, value: string) {
  return createHash("sha256")
    .update(provider, "utf8")
    .update(Buffer.from([0]))
    .update(value, "utf8")
    .digest("hex");
}

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    id: opaque("receipt"),
    userId: opaque("user"),
    mailboxId: opaque("mailbox"),
    state: "PROCESSING",
    ...overrides
  };
}

function uniqueConflict(target?: string[], modelName = "InboundEmailReceipt") {
  return new Prisma.PrismaClientKnownRequestError("Synthetic unique conflict", {
    code: "P2002",
    clientVersion: "6.19.0",
    ...(target ? { meta: { modelName, target } } : {})
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("inbound receipt identifier hashing", () => {
  it("hashes the provider namespace and identifier without exposing either input", () => {
    const identifier = opaque("provider-id");
    const hash = hashInboundIdentifier("RESEND", identifier);

    expect(hash).toBe(expectedInboundHash("RESEND", identifier));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(identifier);
    expect(hash).not.toBe(
      createHash("sha256").update(identifier).digest("hex")
    );
  });
});

describe("active inbound mailbox recipient resolution", () => {
  it("parses and normalizes one strict configured-domain recipient", () => {
    expect(
      parseInboundEmailRecipient(
        "M_OPAQUE@INBOUND.AUDIT.INVALID",
        "inbound.audit.invalid"
      )
    ).toEqual({
      localPart: "m_opaque",
      domain: "inbound.audit.invalid"
    });
  });

  it.each([
    ["missing-at", "not-an-address"],
    ["wrong-domain", "m_opaque@other.audit.invalid"],
    ["display-name", "Name <m_opaque@inbound.audit.invalid>"],
    ["recipient-list", "m_one@inbound.audit.invalid,m_two@inbound.audit.invalid"],
    ["crlf", "m_opaque@inbound.audit.invalid\r\nBcc:x@audit.invalid"],
    ["userinfo", "m_opaque:secret@inbound.audit.invalid"],
    ["extra-at", "m_opaque@@inbound.audit.invalid"]
  ])("rejects malformed recipient case %s without ambiguity", (_case, recipient) => {
    expect(
      parseInboundEmailRecipient(recipient, "inbound.audit.invalid")
    ).toBeNull();
  });

  it("normalizes one strict address and queries only its active alias", async () => {
    const aliasLocalPart = `m_${randomBytes(20).toString("hex")}`;
    const domain = `${opaque("mail")}.resend.app`;
    const mailbox = {
      id: opaque("mailbox"),
      userId: opaque("user"),
      aliasLocalPart
    };
    const findFirst = vi.fn(async () => mailbox);

    await expect(
      findActiveMailboxForRecipient(
        { inboundMailbox: { findFirst } } as never,
        `${aliasLocalPart.toUpperCase()}@${domain.toUpperCase()}`,
        domain
      )
    ).resolves.toEqual(mailbox);
    expect(findFirst).toHaveBeenCalledWith({
      where: { aliasLocalPart, status: "ACTIVE" },
      select: { id: true, userId: true, aliasLocalPart: true }
    });
  });

  it.each([
    (alias: string, domain: string) => `${alias}@other.${domain}`,
    (alias: string, domain: string) => `${alias}@${domain},other@${domain}`,
    (alias: string, domain: string) => `Name <${alias}@${domain}>`,
    (alias: string, domain: string) => `${alias}:secret@${domain}`,
    (alias: string, domain: string) => `${alias}@${domain}\r\nBcc:x@example.invalid`,
    (alias: string, domain: string) => `${alias}@@${domain}`
  ])("rejects a recipient that is not exactly one strict configured-domain address", async (build) => {
    const aliasLocalPart = `m_${randomBytes(20).toString("hex")}`;
    const domain = `${opaque("mail")}.resend.app`;
    const findFirst = vi.fn();

    await expect(
      findActiveMailboxForRecipient(
        { inboundMailbox: { findFirst } } as never,
        build(aliasLocalPart, domain),
        domain
      )
    ).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("returns null when no active alias matches", async () => {
    const aliasLocalPart = `m_${randomBytes(20).toString("hex")}`;
    const domain = `${opaque("mail")}.resend.app`;
    const findFirst = vi.fn(async () => null);

    await expect(
      findActiveMailboxForRecipient(
        { inboundMailbox: { findFirst } } as never,
        `${aliasLocalPart}@${domain}`,
        domain
      )
    ).resolves.toBeNull();
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { aliasLocalPart, status: "ACTIVE" } })
    );
  });
});

describe("inbound receipt claiming", () => {
  const now = new Date("2026-08-11T00:00:00.000Z");

  function input() {
    return {
      provider: "RESEND" as const,
      userId: opaque("user"),
      mailboxId: opaque("mailbox"),
      eventId: opaque("event"),
      messageId: opaque("message"),
      now
    };
  }

  it("creates a processing receipt with one attempt and bounded expiry", async () => {
    const claimInput = input();
    const created = {
      id: opaque("receipt"),
      userId: claimInput.userId,
      mailboxId: claimInput.mailboxId
    };
    receiptCreate.mockResolvedValue(created);

    await expect(claimInboundEmailReceipt(claimInput)).resolves.toEqual({
      kind: "claimed",
      receipt: {
        id: created.id,
        userId: claimInput.userId,
        mailboxId: claimInput.mailboxId
      }
    });
    expect(receiptCreate).toHaveBeenCalledWith({
      data: {
        userId: claimInput.userId,
        mailboxId: claimInput.mailboxId,
        providerEventHash: expectedInboundHash("RESEND", claimInput.eventId),
        providerMessageHash: expectedInboundHash("RESEND", claimInput.messageId),
        state: "PROCESSING",
        attemptCount: 1,
        expiresAt: new Date(now.getTime() + INBOUND_RECEIPT_RETENTION_MS)
      },
      select: { id: true, userId: true, mailboxId: true }
    });
  });

  it("returns an existing receipt for a duplicate event", async () => {
    const claimInput = input();
    const existing = receipt({ state: "PROCESSED" });
    receiptCreate.mockRejectedValue(
      uniqueConflict(["providerEventHash"])
    );
    receiptFindUnique.mockResolvedValueOnce(existing);
    receiptUpdateMany.mockResolvedValue({ count: 0 });

    await expect(claimInboundEmailReceipt(claimInput)).resolves.toEqual({
      kind: "duplicate",
      receipt: {
        id: existing.id,
        userId: existing.userId,
        mailboxId: existing.mailboxId
      }
    });
    expect(receiptFindUnique).toHaveBeenCalledWith({
      where: {
        providerEventHash: expectedInboundHash("RESEND", claimInput.eventId)
      },
      select: { id: true, userId: true, mailboxId: true, state: true }
    });
  });

  it("falls back to mailbox/message uniqueness after checking the event", async () => {
    const claimInput = input();
    const existing = receipt({
      userId: claimInput.userId,
      mailboxId: claimInput.mailboxId,
      state: "IGNORED"
    });
    receiptCreate.mockRejectedValue(
      uniqueConflict(["mailboxId", "providerMessageHash"])
    );
    receiptFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);
    receiptUpdateMany.mockResolvedValue({ count: 0 });

    await expect(claimInboundEmailReceipt(claimInput)).resolves.toEqual(
      expect.objectContaining({ kind: "duplicate" })
    );
    expect(receiptFindUnique).toHaveBeenNthCalledWith(2, {
      where: {
        mailboxId_providerMessageHash: {
          mailboxId: claimInput.mailboxId,
          providerMessageHash: expectedInboundHash("RESEND", claimInput.messageId)
        }
      },
      select: { id: true, userId: true, mailboxId: true, state: true }
    });
  });

  it.each(["RECEIVED", "RETRYABLE_FAILED"] as const)(
    "atomically reclaims %s and increments its attempt count",
    async (state) => {
      const claimInput = input();
      const existing = receipt({
        userId: claimInput.userId,
        mailboxId: claimInput.mailboxId,
        state
      });
      receiptCreate.mockRejectedValue(uniqueConflict(["providerEventHash"]));
      receiptFindUnique.mockResolvedValueOnce(existing);
      receiptUpdateMany.mockResolvedValue({ count: 1 });

      await expect(claimInboundEmailReceipt(claimInput)).resolves.toEqual({
        kind: "claimed",
        receipt: {
          id: existing.id,
          userId: existing.userId,
          mailboxId: existing.mailboxId
        }
      });
      expect(receiptUpdateMany).toHaveBeenCalledWith({
        where: {
          id: existing.id,
          userId: claimInput.userId,
          mailboxId: claimInput.mailboxId,
          OR: [
            { state: { in: ["RECEIVED", "RETRYABLE_FAILED"] } },
            {
              state: "PROCESSING",
              updatedAt: {
                lte: new Date(now.getTime() - INBOUND_PROCESSING_LEASE_MS)
              }
            }
          ]
        },
        data: {
          state: "PROCESSING",
          disposition: null,
          attemptCount: { increment: 1 }
        }
      });
    }
  );

  it.each([
    {
      label: "fresh",
      updatedAt: now
    },
    {
      label: "one millisecond before the lease boundary",
      updatedAt: new Date(
        now.getTime() - INBOUND_PROCESSING_LEASE_MS + 1
      )
    }
  ])(
    "does not reclaim a $label processing receipt",
    async ({ updatedAt }) => {
      const claimInput = input();
      const existing = receipt({
        userId: claimInput.userId,
        mailboxId: claimInput.mailboxId,
        state: "PROCESSING",
        updatedAt
      });
      receiptCreate.mockRejectedValue(uniqueConflict(["providerEventHash"]));
      receiptFindUnique.mockResolvedValueOnce(existing);
      receiptUpdateMany.mockResolvedValue({ count: 0 });

      await expect(claimInboundEmailReceipt(claimInput)).resolves.toEqual({
        kind: "processing",
        receipt: {
          id: existing.id,
          userId: existing.userId,
          mailboxId: existing.mailboxId
        }
      });
      expect(receiptUpdateMany).toHaveBeenCalledWith({
        where: {
          id: existing.id,
          userId: claimInput.userId,
          mailboxId: claimInput.mailboxId,
          OR: [
            { state: { in: ["RECEIVED", "RETRYABLE_FAILED"] } },
            {
              state: "PROCESSING",
              updatedAt: {
                lte: new Date(now.getTime() - INBOUND_PROCESSING_LEASE_MS)
              }
            }
          ]
        },
        data: {
          state: "PROCESSING",
          disposition: null,
          attemptCount: { increment: 1 }
        }
      });
    }
  );

  it.each([
    {
      label: "at the inclusive lease boundary",
      updatedAt: new Date(now.getTime() - INBOUND_PROCESSING_LEASE_MS)
    },
    {
      label: "older than the lease",
      updatedAt: new Date(now.getTime() - INBOUND_PROCESSING_LEASE_MS - 1)
    }
  ])(
    "atomically reclaims processing $label and clears its stale disposition",
    async ({ updatedAt }) => {
      const claimInput = input();
      const existing = receipt({
        userId: claimInput.userId,
        mailboxId: claimInput.mailboxId,
        state: "PROCESSING",
        disposition: "PROVIDER_ERROR",
        updatedAt
      });
      receiptCreate.mockRejectedValue(uniqueConflict(["providerEventHash"]));
      receiptFindUnique.mockResolvedValueOnce(existing);
      receiptUpdateMany.mockResolvedValue({ count: 1 });

      await expect(claimInboundEmailReceipt(claimInput)).resolves.toEqual({
        kind: "claimed",
        receipt: {
          id: existing.id,
          userId: existing.userId,
          mailboxId: existing.mailboxId
        }
      });
      expect(receiptUpdateMany).toHaveBeenCalledWith({
        where: {
          id: existing.id,
          userId: claimInput.userId,
          mailboxId: claimInput.mailboxId,
          OR: [
            { state: { in: ["RECEIVED", "RETRYABLE_FAILED"] } },
            {
              state: "PROCESSING",
              updatedAt: {
                lte: new Date(now.getTime() - INBOUND_PROCESSING_LEASE_MS)
              }
            }
          ]
        },
        data: {
          state: "PROCESSING",
          disposition: null,
          attemptCount: { increment: 1 }
        }
      });
    }
  );

  it.each(["PROCESSED", "IGNORED", "TERMINAL_FAILED"] as const)(
    "does not reclaim a %s receipt",
    async (state) => {
      const claimInput = input();
      const existing = receipt({
        userId: claimInput.userId,
        mailboxId: claimInput.mailboxId,
        state
      });
      receiptCreate.mockRejectedValue(uniqueConflict(["providerEventHash"]));
      receiptFindUnique.mockResolvedValueOnce(existing);
      receiptUpdateMany.mockResolvedValue({ count: 0 });

      await expect(claimInboundEmailReceipt(claimInput)).resolves.toEqual(
        expect.objectContaining({ kind: "duplicate" })
      );
      expect(receiptUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: existing.id,
            userId: claimInput.userId,
            mailboxId: claimInput.mailboxId
          })
        })
      );
    }
  );

  it.each([
    uniqueConflict(),
    uniqueConflict(["unrelated"]),
    uniqueConflict(["providerEventHash"], "OtherModel")
  ])("refuses an unrecognized unique-conflict target", async (conflict) => {
    receiptCreate.mockRejectedValue(conflict);

    await expect(claimInboundEmailReceipt(input())).rejects.toBe(conflict);
    expect(receiptFindUnique).not.toHaveBeenCalled();
  });
});

describe("inbound receipt state transitions", () => {
  it.each([
    ["PROCESSED", "TEST_DRAFT_CREATED"],
    ["IGNORED", "UNSUPPORTED"],
    ["RETRYABLE_FAILED", "PROVIDER_ERROR"],
    ["TERMINAL_FAILED", "PARSER_ERROR"]
  ] as const)(
    "moves a matching processing receipt to %s",
    async (state, disposition) => {
      const input = {
        id: opaque("receipt"),
        userId: opaque("user"),
        mailboxId: opaque("mailbox"),
        state,
        disposition
      };
      const updateMany = vi.fn(async () => ({ count: 1 }));
      const db = { inboundEmailReceipt: { updateMany } } as never;

      await expect(markInboundReceipt(db, input)).resolves.toBe(true);
      expect(updateMany).toHaveBeenCalledWith({
        where: {
          id: input.id,
          userId: input.userId,
          mailboxId: input.mailboxId,
          state: "PROCESSING"
        },
        data: { state, disposition }
      });
    }
  );

  it.each(["RECEIVED", "PROCESSING"] as const)(
    "refuses markInboundReceipt target state %s",
    async (state) => {
      const updateMany = vi.fn();

      await expect(
        markInboundReceipt(
          { inboundEmailReceipt: { updateMany } } as never,
          {
            id: opaque("receipt"),
            userId: opaque("user"),
            mailboxId: opaque("mailbox"),
            state,
            disposition: null
          }
        )
      ).resolves.toBe(false);
      expect(updateMany).not.toHaveBeenCalled();
    }
  );

  it("returns false when the receipt ownership triple or prior state does not match", async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }));

    await expect(
      markInboundReceipt(
        { inboundEmailReceipt: { updateMany } } as never,
        {
          id: opaque("receipt"),
          userId: opaque("user"),
          mailboxId: opaque("mailbox"),
          state: "PROCESSED",
          disposition: "TEST_DRAFT_CREATED"
        }
      )
    ).resolves.toBe(false);
  });
});
