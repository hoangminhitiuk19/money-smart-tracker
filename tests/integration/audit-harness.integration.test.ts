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
}, 20_000);

describe("financial audit fixture boundary", () => {
  it("creates two isolated audit users and removes only this run", async () => {
    const first = await createAuditContext(`audit-a-${randomUUID()}`);
    contexts.push(first);
    const second = await createAuditContext(`audit-b-${randomUUID()}`);
    contexts.push(second);

    await cleanupAuditContext(first);

    await expect(
      prisma.user.findMany({
        where: { id: { in: [first.userA.id, first.userB.id] } }
      })
    ).resolves.toEqual([]);
    await expect(
      prisma.user.findMany({
        where: { id: { in: [second.userA.id, second.userB.id] } },
        orderBy: { id: "asc" }
      })
    ).resolves.toHaveLength(2);

    await cleanupAuditContext(second);
  }, 20_000);

  it("keeps normalized and truncated run identifiers collision-safe", async () => {
    const sharedPrefix = "x".repeat(60);
    const first = await createAuditContext(`${sharedPrefix}-first`);
    contexts.push(first);
    const second = await createAuditContext(`${sharedPrefix}-second`);
    contexts.push(second);

    expect(second.userA.email).not.toBe(first.userA.email);
    expect(second.userB.email).not.toBe(first.userB.email);
  }, 20_000);
});
