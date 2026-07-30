import { hash } from "bcryptjs";
import { prisma } from "@/lib/prisma";

export type AuditContext = {
  runId: string;
  userA: { id: string; email: string };
  userB: { id: string; email: string };
};

function auditEmail(runId: string, label: "a" | "b") {
  const safeRunId = runId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

  return `audit-${safeRunId || "run"}-${label}@audit.invalid`;
}

export async function createAuditContext(runId: string): Promise<AuditContext> {
  const [userAPasswordHash, userBPasswordHash] = await Promise.all([
    hash(`audit-fixture:${runId}:a`, 12),
    hash(`audit-fixture:${runId}:b`, 12)
  ]);
  const userAEmail = auditEmail(runId, "a");
  const userBEmail = auditEmail(runId, "b");
  const [userA, userB] = await prisma.$transaction((transaction) =>
    Promise.all([
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
    ])
  );

  return { runId, userA, userB };
}

export async function cleanupAuditContext(context: AuditContext): Promise<void> {
  await prisma.user.deleteMany({
    where: { id: { in: [context.userA.id, context.userB.id] } }
  });
}
