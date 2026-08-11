import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimInboundEmailReceipt } from "@/lib/inbound-email/receipts";
import { prisma } from "@/lib/prisma";
import {
  cleanupAuditContext,
  createAuditContext,
  type AuditContext
} from "@/tests/integration/helpers/audit-context";

let context: AuditContext;
let mailboxId: string;

function opaqueIdentifier() {
  return `${randomUUID()}-${randomBytes(12).toString("hex")}`;
}

beforeAll(async () => {
  context = await createAuditContext(`receipt-claim-${randomUUID()}`);
  const mailbox = await prisma.inboundMailbox.create({
    data: {
      userId: context.userA.id,
      aliasLocalPart: `m_${randomBytes(20).toString("hex")}`
    },
    select: { id: true }
  });
  mailboxId = mailbox.id;
});

afterAll(async () => {
  if (context) await cleanupAuditContext(context);
  await prisma.$disconnect();
});

function claimInput(eventId: string, messageId: string) {
  return {
    provider: "RESEND" as const,
    userId: context.userA.id,
    mailboxId,
    eventId,
    messageId,
    now: new Date()
  };
}

describe("concurrent inbound receipt claims", () => {
  it("leaves one receipt when one event is claimed concurrently", async () => {
    const eventId = opaqueIdentifier();
    const messageId = opaqueIdentifier();
    const results = await Promise.all([
      claimInboundEmailReceipt(claimInput(eventId, messageId)),
      claimInboundEmailReceipt(claimInput(eventId, messageId))
    ]);

    expect(results.map(({ kind }) => kind).sort()).toEqual([
      "claimed",
      "duplicate"
    ]);
    await expect(
      prisma.inboundEmailReceipt.count({
        where: { id: { in: results.map(({ receipt }) => receipt.id) } }
      })
    ).resolves.toBe(1);
  });

  it("leaves one receipt for distinct events carrying one mailbox message", async () => {
    const messageId = opaqueIdentifier();
    const results = await Promise.all([
      claimInboundEmailReceipt(claimInput(opaqueIdentifier(), messageId)),
      claimInboundEmailReceipt(claimInput(opaqueIdentifier(), messageId))
    ]);

    expect(results.map(({ kind }) => kind).sort()).toEqual([
      "claimed",
      "duplicate"
    ]);
    await expect(
      prisma.inboundEmailReceipt.count({
        where: { id: { in: results.map(({ receipt }) => receipt.id) } }
      })
    ).resolves.toBe(1);
  });
});
