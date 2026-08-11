import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  createInboundWebhookDependencies,
  handleInboundEmailWebhook,
  type InboundWebhookDependencies
} from "@/lib/inbound-email/webhook";
import type {
  InboundEmailProvider,
  InboundMessage,
  InboundNotification
} from "@/lib/inbound-email/types";
import { INBOUND_PROCESSING_LEASE_MS } from "@/lib/inbound-email/constants";
import { prisma } from "@/lib/prisma";

const domain = "inbound.audit.invalid";
const createdUserIds: string[] = [];

function opaqueAlias() {
  return `m_${randomBytes(20).toString("hex")}`;
}

function syntheticMessage(label: string): InboundMessage {
  return {
    text: [
      "MONEY SMART TRACKER TEST",
      "Amount: 125000",
      "Currency: VND",
      "Date: 2026-08-10",
      `Merchant: Synthetic Cafe ${label}`
    ].join("\n"),
    html: null,
    attachmentCount: 0
  };
}

function notification(
  recipient: string,
  overrides: Partial<InboundNotification> = {}
): InboundNotification {
  return {
    eventId: `synthetic-event-${randomUUID()}`,
    messageId: randomUUID(),
    recipients: [recipient],
    occurredAt: new Date("2026-08-11T04:00:00.000Z"),
    ...overrides
  };
}

class FakeProvider implements InboundEmailProvider {
  retrievals = 0;

  constructor(
    public currentNotification: InboundNotification,
    public currentMessage: InboundMessage,
    public retrieve: (
      messageId: string,
      signal: AbortSignal
    ) => Promise<InboundMessage> = async () => currentMessage
  ) {}

  verifyNotification(): InboundNotification {
    return this.currentNotification;
  }

  async retrieveMessage(messageId: string, signal: AbortSignal) {
    this.retrievals += 1;
    return this.retrieve(messageId, signal);
  }
}

async function createOwnedMailbox(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `webhook-${label}-${randomUUID()}@audit.invalid`,
      name: "Synthetic webhook audit user",
      passwordHash: "synthetic-non-authenticated-test-hash"
    },
    select: { id: true }
  });
  createdUserIds.push(user.id);
  const mailbox = await prisma.inboundMailbox.create({
    data: { userId: user.id, aliasLocalPart: opaqueAlias() }
  });
  return { user, mailbox, recipient: `${mailbox.aliasLocalPart}@${domain}` };
}

function dependencies(
  provider: InboundEmailProvider
): InboundWebhookDependencies {
  return {
    ...createInboundWebhookDependencies(provider),
    checkAliasRateLimit: async () => ({
      allowed: true,
      unavailable: false,
      limit: 60,
      remaining: 59,
      retryAfterSeconds: 60
    }),
    cleanup: async () => ({ receiptsDeleted: 0, draftsDeleted: 0 }),
    timeoutMs: 2_000
  } as InboundWebhookDependencies;
}

function webhookInput(rawBody: string) {
  return {
    rawBody,
    headers: new Headers({ "x-synthetic-signature": "present" }),
    domain
  };
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("inbound-email webhook PostgreSQL orchestration", () => {
  it("creates one receipt, draft, and activity under concurrent replay", async () => {
    const fixture = await createOwnedMailbox("concurrency");
    const label = randomUUID().slice(0, 12);
    const provider = new FakeProvider(
      notification(fixture.recipient),
      syntheticMessage(label)
    );
    const input = webhookInput(`synthetic-concurrent-raw-${randomUUID()}`);
    const injected = dependencies(provider);

    const results = await Promise.all([
      handleInboundEmailWebhook(input, injected),
      handleInboundEmailWebhook(input, injected)
    ]);

    expect(results.map(({ code }) => code).sort()).toEqual([
      "ACCEPTED",
      "DUPLICATE"
    ]);
    await expect(
      prisma.inboundEmailReceipt.count({ where: { userId: fixture.user.id } })
    ).resolves.toBe(1);
    await expect(
      prisma.transactionDraft.count({
        where: { userId: fixture.user.id, origin: "EMAIL" }
      })
    ).resolves.toBe(1);
    await expect(
      prisma.activityLog.count({
        where: {
          userId: fixture.user.id,
          action: "INBOUND_EMAIL_RECEIVED"
        }
      })
    ).resolves.toBe(1);
  }, 30_000);

  it("reclaims one retryable receipt and creates one draft on provider replay", async () => {
    const fixture = await createOwnedMailbox("retry");
    const currentNotification = notification(fixture.recipient);
    const currentMessage = syntheticMessage(randomUUID().slice(0, 12));
    let fail = true;
    const provider = new FakeProvider(
      currentNotification,
      currentMessage,
      async () => {
        if (fail) {
          fail = false;
          throw { code: "PROVIDER_ERROR" };
        }
        return currentMessage;
      }
    );
    const injected = dependencies(provider);
    const firstAttemptAt = new Date();
    let clock = firstAttemptAt;
    injected.now = () => clock;
    const input = webhookInput(`synthetic-retry-raw-${randomUUID()}`);

    await expect(handleInboundEmailWebhook(input, injected)).resolves.toEqual({
      status: 503,
      code: "RETRY"
    });

    const [failedReceipt, failedMailbox, failedActivities] = await Promise.all([
      prisma.inboundEmailReceipt.findFirstOrThrow({
        where: { userId: fixture.user.id },
        select: { attemptCount: true, state: true, disposition: true }
      }),
      prisma.inboundMailbox.findUniqueOrThrow({
        where: { id: fixture.mailbox.id, userId: fixture.user.id },
        select: { lastDisposition: true, lastReceivedAt: true }
      }),
      prisma.activityLog.findMany({
        where: {
          userId: fixture.user.id,
          action: "INBOUND_EMAIL_RECEIVED"
        },
        select: {
          action: true,
          entityType: true,
          entityId: true,
          metadata: true
        }
      })
    ]);
    expect(failedReceipt).toEqual({
      attemptCount: 1,
      state: "RETRYABLE_FAILED",
      disposition: "PROVIDER_ERROR"
    });
    expect(failedMailbox).toEqual({
      lastDisposition: "PROVIDER_ERROR",
      lastReceivedAt: firstAttemptAt
    });
    expect(failedActivities).toEqual([
      {
        action: "INBOUND_EMAIL_RECEIVED",
        entityType: "InboundEmail",
        entityId: null,
        metadata: { disposition: "PROVIDER_ERROR" }
      }
    ]);

    clock = new Date(firstAttemptAt.getTime() + 1_000);
    await expect(handleInboundEmailWebhook(input, injected)).resolves.toEqual({
      status: 200,
      code: "ACCEPTED"
    });

    const receipts = await prisma.inboundEmailReceipt.findMany({
      where: { userId: fixture.user.id },
      select: { attemptCount: true, state: true, disposition: true }
    });
    expect(receipts).toEqual([
      {
        attemptCount: 2,
        state: "PROCESSED",
        disposition: "TEST_DRAFT_CREATED"
      }
    ]);
    await expect(
      prisma.transactionDraft.count({
        where: { userId: fixture.user.id, origin: "EMAIL" }
      })
    ).resolves.toBe(1);
    const completedActivities = await prisma.activityLog.findMany({
      where: {
        userId: fixture.user.id,
        action: "INBOUND_EMAIL_RECEIVED"
      },
      select: {
        action: true,
        entityType: true,
        entityId: true,
        metadata: true
      }
    });
    expect(completedActivities).toHaveLength(2);
    expect(completedActivities).toEqual(
      expect.arrayContaining([
        {
          action: "INBOUND_EMAIL_RECEIVED",
          entityType: "InboundEmail",
          entityId: null,
          metadata: { disposition: "PROVIDER_ERROR" }
        },
        {
          action: "INBOUND_EMAIL_RECEIVED",
          entityType: "InboundEmail",
          entityId: null,
          metadata: { disposition: "TEST_DRAFT_CREATED" }
        }
      ])
    );
  }, 30_000);

  it("reclaims an abandoned processing receipt only after its fixed lease", async () => {
    const fixture = await createOwnedMailbox("processing-lease");
    const currentNotification = notification(fixture.recipient);
    const currentMessage = syntheticMessage(randomUUID().slice(0, 12));
    const provider = new FakeProvider(currentNotification, currentMessage);
    let clock = new Date();
    let transactionFailures = 2;
    const injected = dependencies(provider);
    const realRunTransaction = injected.runTransaction;
    injected.now = () => clock;
    injected.runTransaction = async (operation) => {
      if (transactionFailures > 0) {
        transactionFailures -= 1;
        throw new Error("Synthetic transaction outage.");
      }
      return realRunTransaction(operation);
    };
    const input = webhookInput(`synthetic-processing-lease-${randomUUID()}`);

    await expect(handleInboundEmailWebhook(input, injected)).resolves.toEqual({
      status: 503,
      code: "RETRY"
    });
    const abandoned = await prisma.inboundEmailReceipt.findFirstOrThrow({
      where: { userId: fixture.user.id },
      select: {
        id: true,
        attemptCount: true,
        state: true,
        disposition: true,
        updatedAt: true
      }
    });
    expect(abandoned).toMatchObject({
      attemptCount: 1,
      state: "PROCESSING",
      disposition: null
    });
    await expect(
      prisma.inboundMailbox.findUniqueOrThrow({
        where: { id: fixture.mailbox.id, userId: fixture.user.id },
        select: { lastDisposition: true, lastReceivedAt: true }
      })
    ).resolves.toEqual({ lastDisposition: null, lastReceivedAt: null });
    await expect(
      prisma.activityLog.count({
        where: {
          userId: fixture.user.id,
          action: "INBOUND_EMAIL_RECEIVED"
        }
      })
    ).resolves.toBe(0);
    clock = new Date(
      abandoned.updatedAt.getTime() + INBOUND_PROCESSING_LEASE_MS - 1
    );
    await expect(handleInboundEmailWebhook(input, injected)).resolves.toEqual({
      status: 200,
      code: "DUPLICATE"
    });
    expect(provider.retrievals).toBe(1);
    await expect(
      prisma.transactionDraft.count({
        where: { userId: fixture.user.id, origin: "EMAIL" }
      })
    ).resolves.toBe(0);
    await expect(
      prisma.activityLog.count({
        where: {
          userId: fixture.user.id,
          action: "INBOUND_EMAIL_RECEIVED"
        }
      })
    ).resolves.toBe(0);
    await expect(
      prisma.inboundEmailReceipt.findUniqueOrThrow({
        where: { id: abandoned.id },
        select: { attemptCount: true, state: true, disposition: true }
      })
    ).resolves.toEqual({
      attemptCount: 1,
      state: "PROCESSING",
      disposition: null
    });

    clock = new Date(
      abandoned.updatedAt.getTime() + INBOUND_PROCESSING_LEASE_MS
    );
    await expect(handleInboundEmailWebhook(input, injected)).resolves.toEqual({
      status: 200,
      code: "ACCEPTED"
    });
    expect(provider.retrievals).toBe(2);
    await expect(
      prisma.inboundEmailReceipt.findUnique({
        where: { id: abandoned.id },
        select: { attemptCount: true, disposition: true, state: true }
      })
    ).resolves.toEqual({
      attemptCount: 2,
      disposition: "TEST_DRAFT_CREATED",
      state: "PROCESSED"
    });
    await expect(
      prisma.transactionDraft.count({
        where: { userId: fixture.user.id, origin: "EMAIL" }
      })
    ).resolves.toBe(1);
    await expect(
      prisma.activityLog.findMany({
        where: {
          userId: fixture.user.id,
          action: "INBOUND_EMAIL_RECEIVED"
        },
        select: {
          action: true,
          entityType: true,
          entityId: true,
          metadata: true
        }
      })
    ).resolves.toEqual([
      {
        action: "INBOUND_EMAIL_RECEIVED",
        entityType: "InboundEmail",
        entityId: null,
        metadata: { disposition: "TEST_DRAFT_CREATED" }
      }
    ]);
  }, 30_000);

  it("blocks a draft when alias rotation commits between retrieval and transaction", async () => {
    const fixture = await createOwnedMailbox("rotation");
    const currentMessage = syntheticMessage(randomUUID().slice(0, 12));
    const rotatedAliasLocalPart = opaqueAlias();
    const provider = new FakeProvider(
      notification(fixture.recipient),
      currentMessage,
      async () => {
        await prisma.inboundMailbox.update({
          where: { id: fixture.mailbox.id, userId: fixture.user.id },
          data: { aliasLocalPart: rotatedAliasLocalPart }
        });
        return currentMessage;
      }
    );

    await expect(
      handleInboundEmailWebhook(
        webhookInput(`synthetic-rotation-raw-${randomUUID()}`),
        dependencies(provider)
      )
    ).resolves.toEqual({ status: 200, code: "IGNORED" });
    await expect(
      prisma.transactionDraft.count({
        where: { userId: fixture.user.id, origin: "EMAIL" }
      })
    ).resolves.toBe(0);
    await expect(
      prisma.inboundEmailReceipt.findFirst({
        where: { userId: fixture.user.id },
        select: { state: true, disposition: true }
      })
    ).resolves.toEqual({ state: "IGNORED", disposition: "UNSUPPORTED" });
    await expect(
      prisma.inboundMailbox.findUniqueOrThrow({
        where: { id: fixture.mailbox.id, userId: fixture.user.id },
        select: {
          aliasLocalPart: true,
          status: true,
          lastDisposition: true,
          lastReceivedAt: true
        }
      })
    ).resolves.toEqual({
      aliasLocalPart: rotatedAliasLocalPart,
      status: "ACTIVE",
      lastDisposition: null,
      lastReceivedAt: null
    });
    await expect(
      prisma.activityLog.count({
        where: {
          userId: fixture.user.id,
          action: "INBOUND_EMAIL_RECEIVED"
        }
      })
    ).resolves.toBe(0);
  }, 30_000);

  it("keeps a cross-owner event replay opaque and leaves the second owner unchanged", async () => {
    const ownerA = await createOwnedMailbox("owner-a");
    const ownerB = await createOwnedMailbox("owner-b");
    const eventId = `synthetic-shared-event-${randomUUID()}`;
    const provider = new FakeProvider(
      notification(ownerA.recipient, { eventId }),
      syntheticMessage(randomUUID().slice(0, 12))
    );
    const injected = dependencies(provider);

    await expect(
      handleInboundEmailWebhook(
        webhookInput(`synthetic-owner-a-raw-${randomUUID()}`),
        injected
      )
    ).resolves.toEqual({ status: 200, code: "ACCEPTED" });

    provider.currentNotification = notification(ownerB.recipient, { eventId });
    await expect(
      handleInboundEmailWebhook(
        webhookInput(`synthetic-owner-b-raw-${randomUUID()}`),
        injected
      )
    ).resolves.toEqual({ status: 200, code: "IGNORED" });

    await expect(
      prisma.inboundEmailReceipt.count({ where: { userId: ownerB.user.id } })
    ).resolves.toBe(0);
    await expect(
      prisma.transactionDraft.count({ where: { userId: ownerB.user.id } })
    ).resolves.toBe(0);
    await expect(
      prisma.activityLog.count({ where: { userId: ownerB.user.id } })
    ).resolves.toBe(0);
    await expect(
      prisma.inboundMailbox.findUnique({
        where: { id: ownerB.mailbox.id, userId: ownerB.user.id },
        select: { lastDisposition: true, lastReceivedAt: true }
      })
    ).resolves.toEqual({ lastDisposition: null, lastReceivedAt: null });
  }, 30_000);

  it("persists no raw webhook, provider identifier, address, or raw message field", async () => {
    const fixture = await createOwnedMailbox("privacy");
    const label = randomUUID().slice(0, 12);
    const currentNotification = notification(fixture.recipient);
    const currentMessage = syntheticMessage(label);
    const sender = `synthetic-sender-${randomUUID()}@audit.invalid`;
    const subject = `synthetic-subject-${randomUUID()}`;
    const rawBody = JSON.stringify({
      event: currentNotification.eventId,
      message: currentNotification.messageId,
      recipient: fixture.recipient,
      sender,
      subject
    });
    const provider = new FakeProvider(currentNotification, currentMessage);

    await expect(
      handleInboundEmailWebhook(webhookInput(rawBody), dependencies(provider))
    ).resolves.toEqual({ status: 200, code: "ACCEPTED" });

    const [mailboxRecord, receiptRecord, draftRecord, activities] =
      await Promise.all([
        prisma.inboundMailbox.findUnique({
          where: { id: fixture.mailbox.id, userId: fixture.user.id },
          select: {
            aliasLocalPart: true,
            status: true,
            lastDisposition: true
          }
        }),
        prisma.inboundEmailReceipt.findFirst({
          where: { userId: fixture.user.id },
          select: {
            providerEventHash: true,
            providerMessageHash: true,
            state: true,
            disposition: true
          }
        }),
        prisma.transactionDraft.findFirst({
          where: { userId: fixture.user.id, origin: "EMAIL" },
          select: { rawRow: true }
        }),
        prisma.activityLog.findMany({
          where: { userId: fixture.user.id },
          select: { action: true, entityType: true, entityId: true, metadata: true }
        })
      ]);
    const persistedSurface = JSON.stringify({
      mailboxRecord,
      receiptRecord,
      draftRawRow: draftRecord?.rawRow,
      activities
    });

    expect(draftRecord?.rawRow).toBeNull();
    expect(activities).toEqual([
      {
        action: "INBOUND_EMAIL_RECEIVED",
        entityType: "InboundEmail",
        entityId: null,
        metadata: { disposition: "TEST_DRAFT_CREATED" }
      }
    ]);
    for (const forbidden of [
      rawBody,
      currentNotification.eventId,
      currentNotification.messageId,
      fixture.recipient,
      sender,
      subject,
      currentMessage.text!
    ]) {
      expect(persistedSurface).not.toContain(forbidden);
    }
  }, 30_000);
});
