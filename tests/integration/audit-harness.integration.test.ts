import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  cleanupAuditContext,
  createAuditContext,
  type AuditContext
} from "@/tests/integration/helpers/audit-context";
import { prisma } from "@/lib/prisma";

const contexts: AuditContext[] = [];

afterAll(async () => {
  await Promise.all(contexts.map(cleanupAuditContext));
  await prisma.$disconnect();
});

describe("financial audit fixture boundary", () => {
  it("creates two isolated audit users and removes only this run", async () => {
    const first = await createAuditContext(`audit-a-${randomUUID()}`);
    contexts.push(first);
    const second = await createAuditContext(`audit-b-${randomUUID()}`);
    contexts.push(second);

    await cleanupAuditContext(first);

    await expect(prisma.user.findUnique({ where: { id: first.userA.id } }))
      .resolves.toBeNull();
    await expect(prisma.user.findUnique({ where: { id: second.userA.id } }))
      .resolves.not.toBeNull();

    await cleanupAuditContext(second);
  });
});
