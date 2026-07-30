import { randomUUID } from "node:crypto";
import {
  CategoryType,
  MoneySourceType,
  QualityRating,
  TransactionType
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as exportTransactions } from "@/app/api/export/transactions/route";
import { createCategory } from "@/lib/actions/categories";
import { createMoneySource } from "@/lib/actions/money-sources";
import { createProject } from "@/lib/actions/projects";
import { createTransaction } from "@/lib/actions/transactions";
import { prisma } from "@/lib/prisma";
import {
  cleanupAuditContext,
  createAuditContext,
  type AuditContext
} from "@/tests/integration/helpers/audit-context";
import { parseCsv } from "@/tests/integration/helpers/csv";
import { REFERENCE_EXPORT_COLUMNS } from "@/tests/integration/helpers/reference-ledger";

const authState = vi.hoisted(() => ({ userId: "" }));

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => ({
    id: authState.userId,
    email: "export-audit@audit.invalid",
    name: "Export audit user"
  }))
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn()
}));

vi.mock("@/lib/security/rate-limit", () => ({
  checkAuthenticatedMutation: vi.fn(async () => ({
    allowed: true,
    unavailable: false,
    limit: 60,
    remaining: 59,
    retryAfterSeconds: 60
  })),
  checkExport: vi.fn(async () => ({
    allowed: true,
    unavailable: false,
    limit: 10,
    remaining: 9,
    retryAfterSeconds: 60
  })),
  RATE_LIMIT_MESSAGE: "Too many requests. Please try again shortly."
}));

type Fixtures = {
  context: AuditContext;
  prefix: string;
  quotedTitle: string;
  multilineDescription: string;
};

const contexts: AuditContext[] = [];
let fixtures: Fixtures;

async function expectOk(result: Promise<{ ok: boolean; error?: string }>) {
  await expect(result).resolves.toEqual({ ok: true });
}

beforeAll(async () => {
  const context = await createAuditContext(`export-${randomUUID()}`);
  contexts.push(context);
  const prefix = `Export ${randomUUID()}`;
  const quotedTitle = `${prefix}, "quoted" expense`;
  const multilineDescription = "Line one\nLine two";

  authState.userId = context.userA.id;
  await expectOk(
    createCategory({
      name: `${prefix} Category`,
      type: CategoryType.EXPENSE,
      defaultQualityRating: QualityRating.A
    })
  );
  await expectOk(
    createMoneySource({
      name: `${prefix} Bank`,
      type: MoneySourceType.BANK_ACCOUNT
    })
  );
  await expectOk(createProject({ name: `${prefix} Project` }));
  const [category, bank, project] = await Promise.all([
    prisma.category.findFirstOrThrow({
      where: { userId: context.userA.id, name: `${prefix} Category` }
    }),
    prisma.moneySource.findFirstOrThrow({
      where: { userId: context.userA.id, name: `${prefix} Bank` }
    }),
    prisma.financialProject.findFirstOrThrow({
      where: { userId: context.userA.id, name: `${prefix} Project` }
    })
  ]);
  await expectOk(
    createTransaction({
      type: TransactionType.INCOME,
      amount: "100.00",
      title: `${prefix} Income`,
      transactionDate: "2026-07-01",
      toMoneySourceId: bank.id
    })
  );
  await expectOk(
    createTransaction({
      type: TransactionType.EXPENSE,
      amount: "12.34",
      title: quotedTitle,
      description: multilineDescription,
      transactionDate: "2026-07-31",
      categoryId: category.id,
      qualityRating: QualityRating.A,
      fromMoneySourceId: bank.id,
      projectId: project.id,
      countTowardFeeWaiver: true
    })
  );

  authState.userId = context.userB.id;
  await expectOk(
    createMoneySource({
      name: `${prefix} Foreign bank`,
      type: MoneySourceType.BANK_ACCOUNT
    })
  );
  const foreignBank = await prisma.moneySource.findFirstOrThrow({
    where: { userId: context.userB.id, name: `${prefix} Foreign bank` }
  });
  await expectOk(
    createTransaction({
      type: TransactionType.EXPENSE,
      amount: "999.00",
      title: `${prefix} Foreign sentinel`,
      transactionDate: "2026-07-31",
      fromMoneySourceId: foreignBank.id
    })
  );

  fixtures = {
    context,
    prefix,
    quotedTitle,
    multilineDescription
  };
}, 30_000);

afterAll(async () => {
  await Promise.all(contexts.map(cleanupAuditContext));
  await prisma.$disconnect();
}, 20_000);

describe("real two-user CSV export", () => {
  it("exports exact columns and owned rows while preserving quoted CSV fields", async () => {
    authState.userId = fixtures.context.userA.id;
    const response = await exportTransactions(
      new Request(
        `http://localhost/api/export/transactions?startDate=2026-07-01&endDate=2026-07-31&userId=${fixtures.context.userB.id}`
      )
    );
    const csv = await response.text();
    const records = parseCsv(csv);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="transactions.csv"'
    );
    expect(records[0]).toEqual([...REFERENCE_EXPORT_COLUMNS]);
    expect(records).toHaveLength(3);
    expect(records.every((record) => record.length === 13)).toBe(true);
    expect(records[1]?.slice(0, 12)).toEqual([
      "2026-07-31T00:00:00.000Z",
      "EXPENSE",
      fixtures.quotedTitle,
      "12.34",
      "VND",
      `${fixtures.prefix} Category`,
      "A",
      `${fixtures.prefix} Bank`,
      "",
      `${fixtures.prefix} Project`,
      fixtures.multilineDescription,
      "true"
    ]);
    expect(records[2]?.slice(0, 12)).toEqual([
      "2026-07-01T00:00:00.000Z",
      "INCOME",
      `${fixtures.prefix} Income`,
      "100",
      "VND",
      "",
      "",
      "",
      `${fixtures.prefix} Bank`,
      "",
      "",
      "false"
    ]);
    expect(csv).not.toContain(`${fixtures.prefix} Foreign sentinel`);
    await expect(
      prisma.activityLog.findFirst({
        where: {
          userId: fixtures.context.userA.id,
          action: "CSV_EXPORTED"
        },
        orderBy: { createdAt: "desc" }
      })
    ).resolves.toMatchObject({
      metadata: expect.objectContaining({ rowCount: 2 })
    });
  }, 20_000);

  it("switches the same route to User B without exposing a single User A row", async () => {
    authState.userId = fixtures.context.userB.id;
    const response = await exportTransactions(
      new Request(
        `http://localhost/api/export/transactions?userId=${fixtures.context.userA.id}`
      )
    );
    const csv = await response.text();
    const records = parseCsv(csv);

    expect(records[0]).toEqual([...REFERENCE_EXPORT_COLUMNS]);
    expect(records).toHaveLength(2);
    expect(records[1]?.[2]).toBe(`${fixtures.prefix} Foreign sentinel`);
    expect(csv).not.toContain(fixtures.quotedTitle);
    expect(csv).not.toContain(`${fixtures.prefix} Income`);
    await expect(
      prisma.activityLog.findFirst({
        where: {
          userId: fixtures.context.userB.id,
          action: "CSV_EXPORTED"
        },
        orderBy: { createdAt: "desc" }
      })
    ).resolves.toMatchObject({
      metadata: expect.objectContaining({ rowCount: 1 })
    });
  }, 20_000);
});
