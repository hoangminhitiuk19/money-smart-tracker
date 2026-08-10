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
let mailboxAAlias: string;

function opaqueValue(bytes = 32) {
  return randomBytes(bytes).toString("hex");
}

beforeAll(async () => {
  context = await createAuditContext(`inbound-schema-${randomUUID()}`);
  mailboxAAlias = opaqueValue(16);
  const [mailboxA, mailboxB] = await Promise.all([
    prisma.inboundMailbox.create({
      data: {
        userId: context.userA.id,
        aliasLocalPart: mailboxAAlias
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

  it("keeps inbound aliases unique across users", async () => {
    await expect(
      prisma.inboundMailbox.update({
        where: { id: mailboxBId },
        data: { aliasLocalPart: mailboxAAlias }
      })
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("deduplicates a provider event across mailboxes", async () => {
    const repeatedEventHash = opaqueValue();
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    await prisma.inboundEmailReceipt.create({
      data: {
        userId: context.userA.id,
        mailboxId: mailboxAId,
        providerEventHash: repeatedEventHash,
        providerMessageHash: opaqueValue(),
        expiresAt
      }
    });

    await expect(
      prisma.inboundEmailReceipt.create({
        data: {
          userId: context.userB.id,
          mailboxId: mailboxBId,
          providerEventHash: repeatedEventHash,
          providerMessageHash: opaqueValue(),
          expiresAt
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

  it("allows the same provider message hash in different mailboxes", async () => {
    const sharedMessageHash = opaqueValue();
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    await Promise.all([
      prisma.inboundEmailReceipt.create({
        data: {
          userId: context.userA.id,
          mailboxId: mailboxAId,
          providerEventHash: opaqueValue(),
          providerMessageHash: sharedMessageHash,
          expiresAt
        }
      }),
      prisma.inboundEmailReceipt.create({
        data: {
          userId: context.userB.id,
          mailboxId: mailboxBId,
          providerEventHash: opaqueValue(),
          providerMessageHash: sharedMessageHash,
          expiresAt
        }
      })
    ]);

    await expect(
      prisma.inboundEmailReceipt.count({
        where: { providerMessageHash: sharedMessageHash }
      })
    ).resolves.toBe(2);
  });

  it("allows at most one transaction draft per receipt", async () => {
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const receipt = await prisma.inboundEmailReceipt.create({
      data: {
        userId: context.userA.id,
        mailboxId: mailboxAId,
        providerEventHash: opaqueValue(),
        providerMessageHash: opaqueValue(),
        expiresAt
      },
      select: { id: true }
    });
    const captureKey = randomUUID();
    const [firstDraft, secondDraft] = await Promise.all([
      prisma.transactionDraft.create({
        data: {
          userId: context.userA.id,
          captureKey,
          position: 0,
          origin: "EMAIL",
          inboundEmailReceiptId: receipt.id,
          expiresAt
        },
        select: { id: true }
      }),
      prisma.transactionDraft.create({
        data: {
          userId: context.userA.id,
          captureKey,
          position: 1,
          origin: "EMAIL",
          expiresAt
        },
        select: { id: true }
      })
    ]);

    await expect(
      prisma.transactionDraft.update({
        where: { id: secondDraft.id },
        data: { inboundEmailReceiptId: receipt.id }
      })
    ).rejects.toMatchObject({ code: "P2002" });
    await expect(
      prisma.inboundEmailReceipt.findUnique({
        where: { id: receipt.id },
        select: { draft: { select: { id: true } } }
      })
    ).resolves.toEqual({ draft: { id: firstDraft.id } });
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

  it("deploys indexes with the declared uniqueness and ordered columns", async () => {
    const indexes = await prisma.$queryRaw<
      Array<{ indexName: string; isUnique: boolean; columns: string[] }>
    >`
      SELECT
        index_class.relname AS "indexName",
        index_definition.indisunique AS "isUnique",
        array_agg(attribute.attname ORDER BY index_key.ordinality) AS columns
      FROM pg_index AS index_definition
      JOIN pg_class AS table_class
        ON table_class.oid = index_definition.indrelid
      JOIN pg_namespace AS table_namespace
        ON table_namespace.oid = table_class.relnamespace
      JOIN pg_class AS index_class
        ON index_class.oid = index_definition.indexrelid
      JOIN LATERAL unnest(index_definition.indkey::smallint[])
        WITH ORDINALITY AS index_key(attnum, ordinality)
        ON true
      JOIN pg_attribute AS attribute
        ON attribute.attrelid = table_class.oid
        AND attribute.attnum = index_key.attnum
      WHERE table_namespace.nspname = current_schema()
        AND table_class.relname IN (
          'InboundMailbox',
          'InboundEmailReceipt',
          'TransactionDraft'
        )
        AND index_class.relname IN (
          'InboundMailbox_userId_key',
          'InboundMailbox_aliasLocalPart_key',
          'InboundMailbox_status_idx',
          'InboundEmailReceipt_providerEventHash_key',
          'InboundEmailReceipt_mailboxId_providerMessageHash_key',
          'InboundEmailReceipt_userId_state_idx',
          'InboundEmailReceipt_expiresAt_idx',
          'TransactionDraft_inboundEmailReceiptId_key'
        )
      GROUP BY index_class.relname, index_definition.indisunique
      ORDER BY index_class.relname
    `;

    expect(indexes).toEqual([
      {
        indexName: "InboundEmailReceipt_expiresAt_idx",
        isUnique: false,
        columns: ["expiresAt"]
      },
      {
        indexName: "InboundEmailReceipt_mailboxId_providerMessageHash_key",
        isUnique: true,
        columns: ["mailboxId", "providerMessageHash"]
      },
      {
        indexName: "InboundEmailReceipt_providerEventHash_key",
        isUnique: true,
        columns: ["providerEventHash"]
      },
      {
        indexName: "InboundEmailReceipt_userId_state_idx",
        isUnique: false,
        columns: ["userId", "state"]
      },
      {
        indexName: "InboundMailbox_aliasLocalPart_key",
        isUnique: true,
        columns: ["aliasLocalPart"]
      },
      {
        indexName: "InboundMailbox_status_idx",
        isUnique: false,
        columns: ["status"]
      },
      {
        indexName: "InboundMailbox_userId_key",
        isUnique: true,
        columns: ["userId"]
      },
      {
        indexName: "TransactionDraft_inboundEmailReceiptId_key",
        isUnique: true,
        columns: ["inboundEmailReceiptId"]
      }
    ]);
  });
});
