import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  cleanupAuditContext,
  createAuditContext,
  type AuditContext
} from "@/tests/integration/helpers/audit-context";

let context: AuditContext;
let mailboxAId: string;
let mailboxBId: string;

function opaqueValue(bytes = 32) {
  return randomBytes(bytes).toString("hex");
}

beforeAll(async () => {
  context = await createAuditContext(`inbound-schema-${randomUUID()}`);
  const [mailboxA, mailboxB] = await Promise.all([
    prisma.inboundMailbox.create({
      data: {
        userId: context.userA.id,
        aliasLocalPart: opaqueValue(16)
      },
      select: { id: true }
    }),
    prisma.inboundMailbox.create({
      data: {
        userId: context.userB.id,
        aliasLocalPart: opaqueValue(16)
      },
      select: { id: true }
    })
  ]);
  mailboxAId = mailboxA.id;
  mailboxBId = mailboxB.id;
});

afterAll(async () => {
  if (context) await cleanupAuditContext(context);
  await prisma.$disconnect();
});

describe("inbound email persistence constraints", () => {
  it("allows only one inbound mailbox per user", async () => {
    const secondAlias = opaqueValue(16);

    await expect(
      prisma.inboundMailbox.create({
        data: {
          userId: context.userA.id,
          aliasLocalPart: secondAlias
        }
      })
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("deduplicates a provider message within its mailbox", async () => {
    const repeatedMessageHash = opaqueValue();
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    await prisma.inboundEmailReceipt.create({
      data: {
        userId: context.userA.id,
        mailboxId: mailboxAId,
        providerEventHash: opaqueValue(),
        providerMessageHash: repeatedMessageHash,
        expiresAt
      }
    });

    await expect(
      prisma.inboundEmailReceipt.create({
        data: {
          userId: context.userA.id,
          mailboxId: mailboxAId,
          providerEventHash: opaqueValue(),
          providerMessageHash: repeatedMessageHash,
          expiresAt
        }
      })
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("cascades owned mailboxes and receipts when their user is deleted", async () => {
    const receipt = await prisma.inboundEmailReceipt.create({
      data: {
        userId: context.userB.id,
        mailboxId: mailboxBId,
        providerEventHash: opaqueValue(),
        providerMessageHash: opaqueValue(),
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
      },
      select: { id: true }
    });

    await prisma.user.delete({ where: { id: context.userB.id } });

    await expect(
      prisma.inboundMailbox.findUnique({ where: { id: mailboxBId } })
    ).resolves.toBeNull();
    await expect(
      prisma.inboundEmailReceipt.findUnique({ where: { id: receipt.id } })
    ).resolves.toBeNull();
  });

  it("sets draft receipt provenance to null without deleting the draft", async () => {
    const receipt = await prisma.inboundEmailReceipt.create({
      data: {
        userId: context.userA.id,
        mailboxId: mailboxAId,
        providerEventHash: opaqueValue(),
        providerMessageHash: opaqueValue(),
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
      },
      select: { id: true }
    });
    await prisma.transactionDraft.update({
      where: { id: context.userA.transactionDraftId },
      data: { inboundEmailReceiptId: receipt.id }
    });

    await prisma.inboundEmailReceipt.delete({ where: { id: receipt.id } });

    await expect(
      prisma.transactionDraft.findUnique({
        where: { id: context.userA.transactionDraftId },
        select: { id: true, inboundEmailReceiptId: true }
      })
    ).resolves.toEqual({
      id: context.userA.transactionDraftId,
      inboundEmailReceiptId: null
    });
  });

  it("deploys the declared mailbox, receipt, and draft indexes", async () => {
    const indexes = await prisma.$queryRaw<
      Array<{ indexname: string }>
    >`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename IN (
          'InboundMailbox',
          'InboundEmailReceipt',
          'TransactionDraft'
        )
        AND indexname IN (
          'InboundMailbox_userId_key',
          'InboundMailbox_aliasLocalPart_key',
          'InboundMailbox_status_idx',
          'InboundEmailReceipt_providerEventHash_key',
          'InboundEmailReceipt_mailboxId_providerMessageHash_key',
          'InboundEmailReceipt_userId_state_idx',
          'InboundEmailReceipt_expiresAt_idx',
          'TransactionDraft_inboundEmailReceiptId_key'
        )
      ORDER BY indexname
    `;

    expect(indexes.map(({ indexname }) => indexname)).toEqual([
      "InboundEmailReceipt_expiresAt_idx",
      "InboundEmailReceipt_mailboxId_providerMessageHash_key",
      "InboundEmailReceipt_providerEventHash_key",
      "InboundEmailReceipt_userId_state_idx",
      "InboundMailbox_aliasLocalPart_key",
      "InboundMailbox_status_idx",
      "InboundMailbox_userId_key",
      "TransactionDraft_inboundEmailReceiptId_key"
    ]);
  });
});
