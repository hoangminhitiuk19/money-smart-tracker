"use server";

import {
  InboundEmailDisposition,
  InboundMailboxStatus,
  Prisma,
  TransactionDraftOrigin,
  TransactionDraftStatus,
  type InboundMailbox
} from "@prisma/client";
import { requireAuth } from "@/lib/auth";
import {
  getInboundEmailConfig,
  type InboundEmailConfig
} from "@/lib/env";
import {
  generateInboundAliasLocalPart,
  inboundAddress
} from "@/lib/inbound-email/mailboxes";
import { lockOwnedInboundMailbox } from "@/lib/inbound-email/mailbox-lock";
import { prisma } from "@/lib/prisma";
import {
  checkAuthenticatedMutation,
  RATE_LIMIT_MESSAGE
} from "@/lib/security/rate-limit";
import { cleanupExpiredTransactionDrafts } from "@/lib/transaction-drafts/retention";

const CONFIGURATION_ERROR = "Inbound email testing is unavailable.";
const UPDATE_ERROR = "Unable to update inbound email settings.";
const LOAD_ERROR = "Unable to load inbound email settings.";
const MAILBOX_NOT_FOUND_ERROR = "Inbound email testing is not connected.";
const ALIAS_COLLISION_RETRIES = 3;
const EDITABLE_EMAIL_DRAFT_STATUSES: TransactionDraftStatus[] = [
  TransactionDraftStatus.NEEDS_REVIEW,
  TransactionDraftStatus.READY
];
const EDITABLE_EMAIL_DRAFT_WHERE = {
  origin: TransactionDraftOrigin.EMAIL,
  status: { in: EDITABLE_EMAIL_DRAFT_STATUSES }
};

const safeActions = [
  "INBOUND_EMAIL_CONNECTED",
  "INBOUND_EMAIL_ALIAS_ROTATED",
  "INBOUND_EMAIL_ENABLED",
  "INBOUND_EMAIL_DISABLED",
  "INBOUND_EMAIL_PENDING_DELETED",
  "INBOUND_EMAIL_DISCONNECTED",
  "INBOUND_EMAIL_RECEIVED"
] as const;

type LifecycleActivityAction = Exclude<
  (typeof safeActions)[number],
  "INBOUND_EMAIL_RECEIVED"
>;
type LifecycleActivityMetadata = { deletedDraftCount?: number };
type SetupDatabase = Pick<
  Prisma.TransactionClient,
  "inboundMailbox" | "transactionDraft"
>;

export type InboundEmailSetupView = {
  configured: boolean;
  mailbox: null | {
    address: string | null;
    status: "ACTIVE" | "DISABLED";
    lastDisposition: InboundEmailDisposition | null;
    lastReceivedAt: string | null;
    reviewCaptureKey: string | null;
  };
};

export type InboundEmailActionResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

function actionFailure<T>(error: string): InboundEmailActionResult<T> {
  return { ok: false, error };
}

function inboundMailboxUniqueConflictTarget(
  error: unknown
): "userId" | "aliasLocalPart" | null {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return null;
  }

  const modelName = error.meta?.modelName;
  if (modelName !== undefined && modelName !== "InboundMailbox") {
    return null;
  }

  const target = error.meta?.target;
  const field =
    Array.isArray(target) && target.length === 1 ? target[0] : target;
  return field === "userId" || field === "aliasLocalPart" ? field : null;
}

async function logLifecycleActivity(
  db: Prisma.TransactionClient,
  userId: string,
  action: LifecycleActivityAction,
  metadata?: LifecycleActivityMetadata
) {
  const safeAction = safeActions.find((candidate) => candidate === action);
  if (!safeAction) {
    throw new Error("Unsupported inbound email activity action.");
  }
  await db.activityLog.create({
    data: {
      userId,
      action: safeAction,
      entityType: "InboundEmail",
      entityId: null,
      ...(metadata ? { metadata } : {})
    }
  });
}

async function setupView(
  db: SetupDatabase,
  userId: string,
  config: InboundEmailConfig | null,
  knownMailbox?: InboundMailbox | null
): Promise<InboundEmailSetupView> {
  const mailbox =
    knownMailbox === undefined
      ? await db.inboundMailbox.findUnique({ where: { userId } })
      : knownMailbox;

  if (!mailbox) {
    return { configured: config !== null, mailbox: null };
  }

  const reviewDraft = await db.transactionDraft.findFirst({
    where: {
      userId,
      ...EDITABLE_EMAIL_DRAFT_WHERE
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { captureKey: true }
  });

  return {
    configured: config !== null,
    mailbox: {
      address: config
        ? inboundAddress(mailbox.aliasLocalPart, config.domain)
        : null,
      status: mailbox.status,
      lastDisposition: mailbox.lastDisposition,
      lastReceivedAt: mailbox.lastReceivedAt?.toISOString() ?? null,
      reviewCaptureKey: reviewDraft?.captureKey ?? null
    }
  };
}

async function authorizeMutation(
  userId: string
): Promise<{ ok: false; error: string } | null> {
  try {
    const rateLimit = await checkAuthenticatedMutation(userId);
    return rateLimit.allowed
      ? null
      : { ok: false, error: RATE_LIMIT_MESSAGE };
  } catch {
    return { ok: false, error: UPDATE_ERROR };
  }
}

export async function getInboundEmailSetup(): Promise<
  InboundEmailActionResult<{ setup: InboundEmailSetupView }>
> {
  const user = await requireAuth();

  try {
    await cleanupExpiredTransactionDrafts();
  } catch {
    // Retention is opportunistic and must not make privacy controls unavailable.
  }

  try {
    const config = getInboundEmailConfig();
    return {
      ok: true,
      setup: await setupView(prisma, user.id, config)
    };
  } catch {
    return actionFailure(LOAD_ERROR);
  }
}

export async function createInboundMailbox(): Promise<
  InboundEmailActionResult<{ setup: InboundEmailSetupView }>
> {
  const user = await requireAuth();
  const denied = await authorizeMutation(user.id);
  if (denied) {
    return denied;
  }

  let config: InboundEmailConfig | null;
  try {
    config = getInboundEmailConfig();
  } catch {
    return actionFailure(CONFIGURATION_ERROR);
  }
  if (!config) {
    return actionFailure(CONFIGURATION_ERROR);
  }

  for (let attempt = 0; attempt <= ALIAS_COLLISION_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(async (db) => {
        const existing = await db.inboundMailbox.findUnique({
          where: { userId: user.id }
        });
        if (existing) {
          return {
            ok: true,
            setup: await setupView(db, user.id, config, existing)
          };
        }

        const created = await db.inboundMailbox.create({
          data: {
            userId: user.id,
            aliasLocalPart: generateInboundAliasLocalPart()
          }
        });
        await logLifecycleActivity(
          db,
          user.id,
          "INBOUND_EMAIL_CONNECTED"
        );
        return {
          ok: true,
          setup: await setupView(db, user.id, config, created)
        };
      });
    } catch (error) {
      const conflictTarget = inboundMailboxUniqueConflictTarget(error);
      if (conflictTarget === "aliasLocalPart") {
        continue;
      }
      if (conflictTarget !== "userId") {
        return actionFailure(UPDATE_ERROR);
      }

      try {
        const concurrent = await prisma.inboundMailbox.findUnique({
          where: { userId: user.id }
        });
        if (concurrent) {
          return {
            ok: true,
            setup: await setupView(prisma, user.id, config, concurrent)
          };
        }
      } catch {
        return actionFailure(UPDATE_ERROR);
      }

      return actionFailure(UPDATE_ERROR);
    }
  }

  return actionFailure(UPDATE_ERROR);
}

export async function rotateInboundMailbox(): Promise<
  InboundEmailActionResult<{ setup: InboundEmailSetupView }>
> {
  const user = await requireAuth();
  const denied = await authorizeMutation(user.id);
  if (denied) {
    return denied;
  }

  let config: InboundEmailConfig | null;
  try {
    config = getInboundEmailConfig();
  } catch {
    return actionFailure(CONFIGURATION_ERROR);
  }
  if (!config) {
    return actionFailure(CONFIGURATION_ERROR);
  }

  for (let attempt = 0; attempt <= ALIAS_COLLISION_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(async (db) => {
        const existing = await lockOwnedInboundMailbox(db, {
          userId: user.id
        });
        if (!existing) {
          return actionFailure(MAILBOX_NOT_FOUND_ERROR);
        }

        const aliasLocalPart = generateInboundAliasLocalPart();
        const updated = await db.inboundMailbox.updateMany({
          where: { userId: user.id, id: existing.id },
          data: {
            aliasLocalPart,
            lastDisposition: null,
            lastReceivedAt: null
          }
        });
        if (updated.count !== 1) {
          return actionFailure(MAILBOX_NOT_FOUND_ERROR);
        }

        await logLifecycleActivity(
          db,
          user.id,
          "INBOUND_EMAIL_ALIAS_ROTATED"
        );
        return {
          ok: true,
          setup: await setupView(db, user.id, config, {
            ...existing,
            aliasLocalPart,
            lastDisposition: null,
            lastReceivedAt: null
          })
        };
      });
    } catch (error) {
      if (inboundMailboxUniqueConflictTarget(error) !== "aliasLocalPart") {
        return actionFailure(UPDATE_ERROR);
      }
    }
  }

  return actionFailure(UPDATE_ERROR);
}

async function setInboundMailboxStatus(
  status: typeof InboundMailboxStatus.ACTIVE | typeof InboundMailboxStatus.DISABLED,
  action: "INBOUND_EMAIL_ENABLED" | "INBOUND_EMAIL_DISABLED"
): Promise<InboundEmailActionResult<{ setup: InboundEmailSetupView }>> {
  const user = await requireAuth();
  const denied = await authorizeMutation(user.id);
  if (denied) {
    return denied;
  }

  let config: InboundEmailConfig | null;
  try {
    config = getInboundEmailConfig();
  } catch {
    config = null;
  }

  try {
    return await prisma.$transaction(async (db) => {
      const existing = await lockOwnedInboundMailbox(db, {
        userId: user.id
      });
      if (!existing) {
        return actionFailure(MAILBOX_NOT_FOUND_ERROR);
      }

      const updated = await db.inboundMailbox.updateMany({
        where: { userId: user.id, id: existing.id },
        data: { status }
      });
      if (updated.count !== 1) {
        return actionFailure(MAILBOX_NOT_FOUND_ERROR);
      }

      await logLifecycleActivity(db, user.id, action);
      return {
        ok: true,
        setup: await setupView(db, user.id, config, { ...existing, status })
      };
    });
  } catch {
    return actionFailure(UPDATE_ERROR);
  }
}

export async function enableInboundMailbox(): Promise<
  InboundEmailActionResult<{ setup: InboundEmailSetupView }>
> {
  return setInboundMailboxStatus(
    InboundMailboxStatus.ACTIVE,
    "INBOUND_EMAIL_ENABLED"
  );
}

export async function disableInboundMailbox(): Promise<
  InboundEmailActionResult<{ setup: InboundEmailSetupView }>
> {
  return setInboundMailboxStatus(
    InboundMailboxStatus.DISABLED,
    "INBOUND_EMAIL_DISABLED"
  );
}

export async function deletePendingInboundEmailDrafts(): Promise<
  InboundEmailActionResult<{
    deletedCount: number;
    setup: InboundEmailSetupView;
  }>
> {
  const user = await requireAuth();
  const denied = await authorizeMutation(user.id);
  if (denied) {
    return denied;
  }

  let config: InboundEmailConfig | null;
  try {
    config = getInboundEmailConfig();
  } catch {
    config = null;
  }

  try {
    return await prisma.$transaction(async (db) => {
      const mailbox = await lockOwnedInboundMailbox(db, {
        userId: user.id
      });
      const deleted = await db.transactionDraft.deleteMany({
        where: {
          userId: user.id,
          ...EDITABLE_EMAIL_DRAFT_WHERE
        }
      });
      await logLifecycleActivity(
        db,
        user.id,
        "INBOUND_EMAIL_PENDING_DELETED",
        { deletedDraftCount: deleted.count }
      );
      return {
        ok: true,
        deletedCount: deleted.count,
        setup: await setupView(db, user.id, config, mailbox)
      };
    });
  } catch {
    return actionFailure(UPDATE_ERROR);
  }
}

export async function disconnectInboundMailbox(): Promise<
  InboundEmailActionResult<{
    deletedDraftCount: number;
    disconnected: true;
  }>
> {
  const user = await requireAuth();
  const denied = await authorizeMutation(user.id);
  if (denied) {
    return denied;
  }

  try {
    return await prisma.$transaction(async (db) => {
      await lockOwnedInboundMailbox(db, { userId: user.id });
      const deletedDrafts = await db.transactionDraft.deleteMany({
        where: {
          userId: user.id,
          ...EDITABLE_EMAIL_DRAFT_WHERE
        }
      });
      await db.inboundMailbox.deleteMany({ where: { userId: user.id } });
      await logLifecycleActivity(
        db,
        user.id,
        "INBOUND_EMAIL_DISCONNECTED",
        { deletedDraftCount: deletedDrafts.count }
      );
      return {
        ok: true,
        deletedDraftCount: deletedDrafts.count,
        disconnected: true
      };
    });
  } catch {
    return actionFailure(UPDATE_ERROR);
  }
}
