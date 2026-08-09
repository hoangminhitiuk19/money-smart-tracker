import { createHash } from "node:crypto";
import { hash } from "bcryptjs";
import { prisma } from "@/lib/prisma";

export type AuditContext = {
  runId: string;
  userA: {
    id: string;
    email: string;
    transactionDraftId: string;
    transactionImportBatchId: string;
  };
  userB: {
    id: string;
    email: string;
    transactionDraftId: string;
    transactionImportBatchId: string;
  };
};

function auditEmail(runId: string, label: "a" | "b") {
  const safeRunId = runId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const digest = createHash("sha256").update(runId).digest("hex").slice(0, 12);

  return `audit-${safeRunId || "run"}-${digest}-${label}@audit.invalid`;
}

export async function createAuditContext(runId: string): Promise<AuditContext> {
  const [userAPasswordHash, userBPasswordHash] = await Promise.all([
    hash(`audit-fixture:${runId}:a`, 12),
    hash(`audit-fixture:${runId}:b`, 12)
  ]);
  const userAEmail = auditEmail(runId, "a");
  const userBEmail = auditEmail(runId, "b");
  const context = await prisma.$transaction(async (transaction) => {
    const [userA, userB] = await Promise.all([
      transaction.user.create({
        data: {
          email: userAEmail,
          name: "Audit fixture user A",
          passwordHash: userAPasswordHash
        },
        select: { id: true, email: true }
      }),
      transaction.user.create({
        data: {
          email: userBEmail,
          name: "Audit fixture user B",
          passwordHash: userBPasswordHash
        },
        select: { id: true, email: true }
      })
    ]);
    const [importBatchA, importBatchB] = await Promise.all([
      transaction.transactionImportBatch.create({
        data: {
          userId: userA.id,
          idempotencyKey: `audit-fixture:${runId}:a`,
          origin: "QUICK"
        },
        select: { id: true }
      }),
      transaction.transactionImportBatch.create({
        data: {
          userId: userB.id,
          idempotencyKey: `audit-fixture:${runId}:b`,
          origin: "QUICK"
        },
        select: { id: true }
      })
    ]);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const [draftA, draftB] = await Promise.all([
      transaction.transactionDraft.create({
        data: {
          userId: userA.id,
          captureKey: `audit-fixture:${runId}:a`,
          position: 0,
          origin: "QUICK",
          expiresAt,
          importBatchId: importBatchA.id
        },
        select: { id: true }
      }),
      transaction.transactionDraft.create({
        data: {
          userId: userB.id,
          captureKey: `audit-fixture:${runId}:b`,
          position: 0,
          origin: "QUICK",
          expiresAt,
          importBatchId: importBatchB.id
        },
        select: { id: true }
      })
    ]);

    return {
      runId,
      userA: {
        ...userA,
        transactionDraftId: draftA.id,
        transactionImportBatchId: importBatchA.id
      },
      userB: {
        ...userB,
        transactionDraftId: draftB.id,
        transactionImportBatchId: importBatchB.id
      }
    };
  });

  return context;
}

export async function cleanupAuditContext(context: AuditContext): Promise<void> {
  await prisma.user.deleteMany({
    where: { id: { in: [context.userA.id, context.userB.id] } }
  });

  const [remainingDrafts, remainingImportBatches] = await Promise.all([
    prisma.transactionDraft.count({
      where: {
        id: { in: [context.userA.transactionDraftId, context.userB.transactionDraftId] }
      }
    }),
    prisma.transactionImportBatch.count({
      where: {
        id: {
          in: [
            context.userA.transactionImportBatchId,
            context.userB.transactionImportBatchId
          ]
        }
      }
    })
  ]);

  if (remainingDrafts !== 0 || remainingImportBatches !== 0) {
    throw new Error("Audit fixture cleanup did not cascade to transaction capture records.");
  }
}
