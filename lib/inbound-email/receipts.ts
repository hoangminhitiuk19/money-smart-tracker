import { createHash } from "node:crypto";
import {
  InboundEmailReceiptState,
  InboundMailboxProvider,
  InboundMailboxStatus,
  Prisma,
  type InboundEmailDisposition
} from "@prisma/client";
import {
  INBOUND_PROCESSING_LEASE_MS,
  INBOUND_RECEIPT_RETENTION_MS
} from "@/lib/inbound-email/constants";
import { prisma } from "@/lib/prisma";

export type InboundReceiptClaim =
  | {
      kind: "claimed";
      receipt: { id: string; userId: string; mailboxId: string };
    }
  | {
      kind: "duplicate";
      receipt: { id: string; userId: string; mailboxId: string };
    };

export type InboundMailboxReader = Pick<
  Prisma.TransactionClient,
  "inboundMailbox"
>;

const receiptSelection = {
  id: true,
  userId: true,
  mailboxId: true
} as const;

const existingReceiptSelection = {
  ...receiptSelection,
  state: true
} as const;

const claimableStates = [
  InboundEmailReceiptState.RECEIVED,
  InboundEmailReceiptState.RETRYABLE_FAILED
] as const;

const markableStates = new Set<InboundEmailReceiptState>([
  InboundEmailReceiptState.PROCESSED,
  InboundEmailReceiptState.IGNORED,
  InboundEmailReceiptState.RETRYABLE_FAILED,
  InboundEmailReceiptState.TERMINAL_FAILED
]);

export function hashInboundIdentifier(
  provider: InboundMailboxProvider,
  value: string
): string {
  return createHash("sha256")
    .update(provider, "utf8")
    .update(Buffer.from([0]))
    .update(value, "utf8")
    .digest("hex");
}

function strictRecipientParts(recipient: string) {
  if (recipient.length === 0 || /[\r\n]/.test(recipient)) {
    return null;
  }

  const match = recipient.match(
    /^([a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?)@([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)$/i
  );
  if (!match) {
    return null;
  }

  return {
    localPart: match[1].toLowerCase(),
    domain: match[2].toLowerCase()
  };
}

export async function findActiveMailboxForRecipient(
  db: InboundMailboxReader,
  recipient: string,
  domain: string
): Promise<{
  id: string;
  userId: string;
  aliasLocalPart: string;
} | null> {
  const parsed = strictRecipientParts(recipient);
  const configuredDomain = domain.toLowerCase();
  if (!parsed || parsed.domain !== configuredDomain) {
    return null;
  }

  return db.inboundMailbox.findFirst({
    where: {
      aliasLocalPart: parsed.localPart,
      status: InboundMailboxStatus.ACTIVE
    },
    select: { id: true, userId: true, aliasLocalPart: true }
  });
}

type ReceiptConflictTarget = "event" | "message";

function receiptConflictTarget(error: unknown): ReceiptConflictTarget | null {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return null;
  }

  const modelName = error.meta?.modelName;
  if (modelName !== undefined && modelName !== "InboundEmailReceipt") {
    return null;
  }

  const target = error.meta?.target;
  if (
    target === "providerEventHash" ||
    (Array.isArray(target) &&
      target.length === 1 &&
      target[0] === "providerEventHash")
  ) {
    return "event";
  }
  if (
    Array.isArray(target) &&
    target.length === 2 &&
    target[0] === "mailboxId" &&
    target[1] === "providerMessageHash"
  ) {
    return "message";
  }

  return null;
}

export async function claimInboundEmailReceipt(input: {
  provider: InboundMailboxProvider;
  userId: string;
  mailboxId: string;
  eventId: string;
  messageId: string;
  now: Date;
}): Promise<InboundReceiptClaim> {
  const providerEventHash = hashInboundIdentifier(input.provider, input.eventId);
  const providerMessageHash = hashInboundIdentifier(
    input.provider,
    input.messageId
  );
  const processingLeaseCutoff = new Date(
    input.now.getTime() - INBOUND_PROCESSING_LEASE_MS
  );

  try {
    const created = await prisma.inboundEmailReceipt.create({
      data: {
        userId: input.userId,
        mailboxId: input.mailboxId,
        providerEventHash,
        providerMessageHash,
        state: InboundEmailReceiptState.PROCESSING,
        attemptCount: 1,
        expiresAt: new Date(input.now.getTime() + INBOUND_RECEIPT_RETENTION_MS)
      },
      select: receiptSelection
    });

    return { kind: "claimed", receipt: created };
  } catch (error) {
    if (!receiptConflictTarget(error)) {
      throw error;
    }

    const existing =
      (await prisma.inboundEmailReceipt.findUnique({
        where: { providerEventHash },
        select: existingReceiptSelection
      })) ??
      (await prisma.inboundEmailReceipt.findUnique({
        where: {
          mailboxId_providerMessageHash: {
            mailboxId: input.mailboxId,
            providerMessageHash
          }
        },
        select: existingReceiptSelection
      }));

    if (!existing) {
      throw error;
    }

    const claimed = await prisma.inboundEmailReceipt.updateMany({
      where: {
        id: existing.id,
        userId: input.userId,
        mailboxId: input.mailboxId,
        OR: [
          { state: { in: [...claimableStates] } },
          {
            state: InboundEmailReceiptState.PROCESSING,
            updatedAt: { lte: processingLeaseCutoff }
          }
        ]
      },
      data: {
        state: InboundEmailReceiptState.PROCESSING,
        disposition: null,
        attemptCount: { increment: 1 }
      }
    });
    const receipt = {
      id: existing.id,
      userId: existing.userId,
      mailboxId: existing.mailboxId
    };

    return claimed.count === 1
      ? { kind: "claimed", receipt }
      : { kind: "duplicate", receipt };
  }
}

export async function markInboundReceipt(
  db: Prisma.TransactionClient,
  input: {
    id: string;
    userId: string;
    mailboxId: string;
    state: InboundEmailReceiptState;
    disposition: InboundEmailDisposition | null;
  }
): Promise<boolean> {
  if (!markableStates.has(input.state)) {
    return false;
  }

  const updated = await db.inboundEmailReceipt.updateMany({
    where: {
      id: input.id,
      userId: input.userId,
      mailboxId: input.mailboxId,
      state: InboundEmailReceiptState.PROCESSING
    },
    data: {
      state: input.state,
      disposition: input.disposition
    }
  });

  return updated.count === 1;
}
