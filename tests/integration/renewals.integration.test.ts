import { randomUUID } from "node:crypto";
import {
  CategoryType,
  MoneySourceType,
  Prisma,
  RenewalFrequency,
  RenewalStatus,
  TransactionType
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  cancelRenewal,
  createRenewal,
  deleteRenewal,
  getRenewal,
  listRenewals,
  markRenewalAsPaid,
  pauseRenewal,
  resumeRenewal,
  skipRenewalCycle,
  updateRenewal
} from "@/lib/actions/renewals";
import { prisma } from "@/lib/prisma";
import {
  cleanupAuditContext,
  createAuditContext,
  type AuditContext
} from "@/tests/integration/helpers/audit-context";

const authState = vi.hoisted(() => ({ userId: "" }));

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => ({
    id: authState.userId,
    email: "renewal-audit@audit.invalid",
    name: "Renewal audit user"
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
  RATE_LIMIT_MESSAGE: "Too many requests. Please try again shortly."
}));

type Fixtures = {
  context: AuditContext;
  sourceAId: string;
  sourceBId: string;
};

let fixtures: Fixtures;

beforeAll(async () => {
  const context = await createAuditContext(`renewals-${randomUUID()}`);
  const [sourceA, sourceB] = await prisma.$transaction([
    prisma.moneySource.create({
      data: {
        userId: context.userA.id,
        name: "Renewal audit source A",
        type: MoneySourceType.BANK_ACCOUNT
      }
    }),
    prisma.moneySource.create({
      data: {
        userId: context.userB.id,
        name: "Renewal audit source B",
        type: MoneySourceType.BANK_ACCOUNT
      }
    })
  ]);

  fixtures = {
    context,
    sourceAId: sourceA.id,
    sourceBId: sourceB.id
  };
  authState.userId = context.userA.id;
}, 20_000);

afterAll(async () => {
  await cleanupAuditContext(fixtures.context);
  await prisma.$disconnect();
});

function renewalData(
  userId = fixtures.context.userA.id,
  overrides: Partial<Prisma.RecurringPaymentUncheckedCreateInput> = {}
): Prisma.RecurringPaymentUncheckedCreateInput {
  return {
    userId,
    title: `Renewal ${randomUUID()}`,
    amount: "100.00",
    currency: "VND",
    transactionType: TransactionType.EXPENSE,
    fromMoneySourceId:
      userId === fixtures.context.userA.id
        ? fixtures.sourceAId
        : fixtures.sourceBId,
    frequency: RenewalFrequency.MONTHLY,
    intervalCount: 1,
    nextDueDate: new Date("2026-07-30T00:00:00.000Z"),
    reminderDaysBefore: 3,
    status: RenewalStatus.ACTIVE,
    ...overrides
  };
}

async function createDirectRenewal(
  userId = fixtures.context.userA.id,
  overrides: Partial<Prisma.RecurringPaymentUncheckedCreateInput> = {}
) {
  return prisma.recurringPayment.create({
    data: renewalData(userId, overrides)
  });
}

async function installActivityFailure(userId: string) {
  const suffix = randomUUID().replaceAll("-", "");
  const functionName = `fail_renewal_activity_${suffix}`;
  const triggerName = `fail_renewal_activity_trigger_${suffix}`;

  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION "${functionName}"() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW."userId" = '${userId}' AND NEW."action" LIKE 'RENEWAL_%' THEN
        RAISE EXCEPTION 'forced renewal activity failure';
      END IF;
      RETURN NEW;
    END;
    $$;
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER "${triggerName}"
    BEFORE INSERT ON "ActivityLog"
    FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
  `);

  return async () => {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS "${triggerName}" ON "ActivityLog"`
    );
    await prisma.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS "${functionName}"()`
    );
  };
}

describe("canonical renewal payment workflow", () => {
  it("creates exactly one exact-Decimal transaction and advances one cycle with canonical activity metadata", async () => {
    const renewal = await createDirectRenewal(fixtures.context.userA.id, {
      title: `Canonical payment ${randomUUID()}`,
      amount: "100.00",
      nextDueDate: new Date("2026-07-30T00:00:00.000Z")
    });

    const created = await markRenewalAsPaid(renewal.id);
    const [transactions, updatedRenewal, activity] = await Promise.all([
      prisma.transaction.findMany({
        where: {
          userId: fixtures.context.userA.id,
          recurringPaymentId: renewal.id
        }
      }),
      prisma.recurringPayment.findUniqueOrThrow({ where: { id: renewal.id } }),
      prisma.activityLog.findFirstOrThrow({
        where: {
          userId: fixtures.context.userA.id,
          action: "RENEWAL_MARKED_PAID",
          entityId: renewal.id
        }
      })
    ]);

    if (!("id" in created)) {
      throw new Error("Expected markRenewalAsPaid to return a transaction.");
    }
    expect(created.id).toBe(transactions[0]?.id);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      userId: fixtures.context.userA.id,
      type: TransactionType.EXPENSE,
      title: renewal.title,
      recurringPaymentId: renewal.id,
      fromMoneySourceId: fixtures.sourceAId
    });
    expect(transactions[0].amount.toFixed(2)).toBe("100.00");
    expect(updatedRenewal.nextDueDate.toISOString()).toBe(
      "2026-08-30T00:00:00.000Z"
    );
    expect(updatedRenewal.lastGeneratedDate).toBeInstanceOf(Date);
    expect(activity.metadata).toEqual({
      renewalId: renewal.id,
      amount: "100.00",
      newNextDueDate: "2026-08-30T00:00:00.000Z"
    });
  });

  it.each([RenewalStatus.PAUSED, RenewalStatus.CANCELLED])(
    "rejects mark-paid and skip for a %s renewal without writes",
    async (status) => {
      const renewal = await createDirectRenewal(fixtures.context.userA.id, {
        status
      });
      const before = await Promise.all([
        prisma.transaction.count({
          where: { recurringPaymentId: renewal.id }
        }),
        prisma.activityLog.count({ where: { entityId: renewal.id } })
      ]);

      await expect(markRenewalAsPaid(renewal.id)).rejects.toThrow(
        "Renewal is not active."
      );
      await expect(skipRenewalCycle(renewal.id)).rejects.toThrow(
        "Renewal is not active."
      );

      const persisted = await prisma.recurringPayment.findUniqueOrThrow({
        where: { id: renewal.id }
      });
      expect(persisted).toMatchObject({
        status,
        nextDueDate: renewal.nextDueDate,
        lastGeneratedDate: null
      });
      await expect(
        Promise.all([
          prisma.transaction.count({
            where: { recurringPaymentId: renewal.id }
          }),
          prisma.activityLog.count({ where: { entityId: renewal.id } })
        ])
      ).resolves.toEqual(before);
    }
  );
});

describe("renewal CRUD and activity contracts", () => {
  it.each([TransactionType.REFUND, TransactionType.ADJUSTMENT])(
    "rejects %s on create and update without renewal or activity writes",
    async (transactionType) => {
      const createTitle = `Unsupported ${transactionType} ${randomUUID()}`;
      const beforeCreate = await Promise.all([
        prisma.recurringPayment.count({
          where: { userId: fixtures.context.userA.id, title: createTitle }
        }),
        prisma.activityLog.count({
          where: {
            userId: fixtures.context.userA.id,
            action: "RENEWAL_CREATED"
          }
        })
      ]);
      const createResult = await createRenewal({
        title: createTitle,
        amount: "10.00",
        transactionType,
        frequency: RenewalFrequency.MONTHLY,
        nextDueDate: new Date("2026-07-30T00:00:00.000Z"),
        ...(transactionType === TransactionType.REFUND
          ? { toMoneySourceId: fixtures.sourceAId }
          : {})
      });

      expect(createResult).toEqual({
        ok: false,
        error: "Renewals support INCOME, EXPENSE, or TRANSFER only."
      });
      await expect(
        Promise.all([
          prisma.recurringPayment.count({
            where: { userId: fixtures.context.userA.id, title: createTitle }
          }),
          prisma.activityLog.count({
            where: {
              userId: fixtures.context.userA.id,
              action: "RENEWAL_CREATED"
            }
          })
        ])
      ).resolves.toEqual(beforeCreate);

      const renewal = await createDirectRenewal();
      const beforeUpdateActivity = await prisma.activityLog.count({
        where: { entityId: renewal.id }
      });
      const updateResult = await updateRenewal(renewal.id, {
        transactionType,
        ...(transactionType === TransactionType.REFUND
          ? { toMoneySourceId: fixtures.sourceAId }
          : {})
      });

      expect(updateResult).toEqual({
        ok: false,
        error: "Renewals support INCOME, EXPENSE, or TRANSFER only."
      });
      await expect(
        prisma.recurringPayment.findUniqueOrThrow({
          where: { id: renewal.id }
        })
      ).resolves.toMatchObject({
        transactionType: TransactionType.EXPENSE,
        fromMoneySourceId: fixtures.sourceAId,
        toMoneySourceId: null
      });
      await expect(
        prisma.activityLog.count({ where: { entityId: renewal.id } })
      ).resolves.toBe(beforeUpdateActivity);
    }
  );

  it("logs canonical persisted changes instead of equivalent raw Decimal input", async () => {
    const renewal = await createDirectRenewal(fixtures.context.userA.id, {
      amount: "123.40"
    });

    await expect(
      updateRenewal(renewal.id, { amount: "123.4" })
    ).resolves.toEqual({ ok: true });

    const [persisted, activity] = await Promise.all([
      prisma.recurringPayment.findUniqueOrThrow({
        where: { id: renewal.id }
      }),
      prisma.activityLog.findFirstOrThrow({
        where: {
          userId: fixtures.context.userA.id,
          action: "RENEWAL_UPDATED",
          entityId: renewal.id
        }
      })
    ]);
    expect(persisted.amount.toFixed(2)).toBe("123.40");
    expect(activity.metadata).toEqual({
      renewalId: renewal.id,
      changedFields: {}
    });
  });

  it("applies fee-waiver defaults, exclusions, explicit overrides, and update transitions", async () => {
    const [card, eligibleCategory, excludedCategory] = await prisma.$transaction([
      prisma.moneySource.create({
        data: {
          userId: fixtures.context.userA.id,
          name: `Renewal waiver card ${randomUUID()}`,
          type: MoneySourceType.CREDIT_CARD
        }
      }),
      prisma.category.create({
        data: {
          userId: fixtures.context.userA.id,
          name: `Renewal eligible category ${randomUUID()}`,
          type: CategoryType.EXPENSE,
          defaultCountTowardFeeWaiver: true
        }
      }),
      prisma.category.create({
        data: {
          userId: fixtures.context.userA.id,
          name: `Renewal excluded category ${randomUUID()}`,
          type: CategoryType.EXPENSE,
          defaultCountTowardFeeWaiver: false
        }
      })
    ]);
    const createCases = [
      {
        label: "card default",
        input: {
          transactionType: TransactionType.EXPENSE,
          fromMoneySourceId: card.id
        },
        expected: true
      },
      {
        label: "excluded category",
        input: {
          transactionType: TransactionType.EXPENSE,
          fromMoneySourceId: card.id,
          categoryId: excludedCategory.id
        },
        expected: false
      },
      {
        label: "bank source",
        input: {
          transactionType: TransactionType.EXPENSE,
          fromMoneySourceId: fixtures.sourceAId
        },
        expected: false
      },
      {
        label: "non-expense",
        input: {
          transactionType: TransactionType.INCOME,
          toMoneySourceId: fixtures.sourceAId,
          countTowardFeeWaiver: true
        },
        expected: false
      },
      {
        label: "explicit false",
        input: {
          transactionType: TransactionType.EXPENSE,
          fromMoneySourceId: card.id,
          countTowardFeeWaiver: false
        },
        expected: false
      },
      {
        label: "explicit true",
        input: {
          transactionType: TransactionType.EXPENSE,
          fromMoneySourceId: card.id,
          categoryId: excludedCategory.id,
          countTowardFeeWaiver: true
        },
        expected: true
      }
    ] as const;

    for (const { label, input, expected } of createCases) {
      const title = `Renewal waiver ${label} ${randomUUID()}`;
      await expect(
        createRenewal({
          title,
          amount: "10.00",
          frequency: RenewalFrequency.MONTHLY,
          nextDueDate: new Date("2026-07-30T00:00:00.000Z"),
          ...input
        })
      ).resolves.toEqual({ ok: true });
      await expect(
        prisma.recurringPayment.findFirstOrThrow({
          where: { userId: fixtures.context.userA.id, title }
        })
      ).resolves.toMatchObject({ countTowardFeeWaiver: expected });
    }

    const transition = await createDirectRenewal(fixtures.context.userA.id, {
      fromMoneySourceId: fixtures.sourceAId,
      categoryId: eligibleCategory.id,
      countTowardFeeWaiver: false
    });
    await expect(
      updateRenewal(transition.id, { fromMoneySourceId: card.id })
    ).resolves.toEqual({ ok: true });
    await expect(
      prisma.recurringPayment.findUniqueOrThrow({
        where: { id: transition.id }
      })
    ).resolves.toMatchObject({ countTowardFeeWaiver: true });

    await expect(
      updateRenewal(transition.id, { categoryId: excludedCategory.id })
    ).resolves.toEqual({ ok: true });
    await expect(
      prisma.recurringPayment.findUniqueOrThrow({
        where: { id: transition.id }
      })
    ).resolves.toMatchObject({ countTowardFeeWaiver: false });

    await expect(
      updateRenewal(transition.id, { countTowardFeeWaiver: true })
    ).resolves.toEqual({ ok: true });
    await expect(
      prisma.recurringPayment.findUniqueOrThrow({
        where: { id: transition.id }
      })
    ).resolves.toMatchObject({ countTowardFeeWaiver: true });

    const incomeForm = new FormData();
    incomeForm.set("transactionType", TransactionType.INCOME);
    incomeForm.set("fromMoneySourceId", "");
    incomeForm.set("toMoneySourceId", fixtures.sourceAId);
    await expect(updateRenewal(transition.id, incomeForm)).resolves.toEqual({
      ok: true
    });
    await expect(
      prisma.recurringPayment.findUniqueOrThrow({
        where: { id: transition.id }
      })
    ).resolves.toMatchObject({
      transactionType: TransactionType.INCOME,
      fromMoneySourceId: null,
      toMoneySourceId: fixtures.sourceAId,
      countTowardFeeWaiver: false
    });

    const expenseForm = new FormData();
    expenseForm.set("transactionType", TransactionType.EXPENSE);
    expenseForm.set("fromMoneySourceId", card.id);
    expenseForm.set("toMoneySourceId", "");
    expenseForm.set("categoryId", eligibleCategory.id);
    await expect(updateRenewal(transition.id, expenseForm)).resolves.toEqual({
      ok: true
    });
    await expect(
      prisma.recurringPayment.findUniqueOrThrow({
        where: { id: transition.id }
      })
    ).resolves.toMatchObject({
      transactionType: TransactionType.EXPENSE,
      fromMoneySourceId: card.id,
      toMoneySourceId: null,
      categoryId: eligibleCategory.id,
      countTowardFeeWaiver: true
    });

    await expect(
      updateRenewal(transition.id, { countTowardFeeWaiver: false })
    ).resolves.toEqual({ ok: true });
    await expect(
      prisma.recurringPayment.findUniqueOrThrow({
        where: { id: transition.id }
      })
    ).resolves.toMatchObject({ countTowardFeeWaiver: false });
  }, 30_000);

  it("preserves Decimal input and emits the §20.2 update, skip, and status metadata shapes", async () => {
    const title = `Exact renewal ${randomUUID()}`;
    const createForm = new FormData();
    createForm.set("title", title);
    createForm.set("amount", "90071992547409.99");
    createForm.set("transactionType", TransactionType.EXPENSE);
    createForm.set("fromMoneySourceId", fixtures.sourceAId);
    createForm.set("frequency", RenewalFrequency.MONTHLY);
    createForm.set("nextDueDate", "2026-07-30");

    await expect(createRenewal(createForm)).resolves.toEqual({ ok: true });
    const renewal = await prisma.recurringPayment.findFirstOrThrow({
      where: { userId: fixtures.context.userA.id, title }
    });
    expect(renewal.amount.toFixed(2)).toBe("90071992547409.99");

    const updateForm = new FormData();
    updateForm.set("amount", "123.45");
    await expect(updateRenewal(renewal.id, updateForm)).resolves.toEqual({
      ok: true
    });
    const updateActivity = await prisma.activityLog.findFirstOrThrow({
      where: {
        userId: fixtures.context.userA.id,
        action: "RENEWAL_UPDATED",
        entityId: renewal.id
      }
    });
    expect(updateActivity.metadata).toEqual({
      renewalId: renewal.id,
      changedFields: {
        amount: ["90071992547409.99", "123.45"]
      }
    });

    await expect(skipRenewalCycle(renewal.id)).resolves.toEqual({ ok: true });
    const skipActivity = await prisma.activityLog.findFirstOrThrow({
      where: {
        userId: fixtures.context.userA.id,
        action: "RENEWAL_SKIPPED",
        entityId: renewal.id
      }
    });
    expect(skipActivity.metadata).toEqual({
      renewalId: renewal.id,
      newNextDueDate: "2026-08-30T00:00:00.000Z"
    });

    await expect(pauseRenewal(renewal.id)).resolves.toEqual({ ok: true });
    await expect(resumeRenewal(renewal.id)).resolves.toEqual({ ok: true });
    await expect(cancelRenewal(renewal.id)).resolves.toEqual({ ok: true });
    const statusActivities = await prisma.activityLog.findMany({
      where: {
        userId: fixtures.context.userA.id,
        entityId: renewal.id,
        action: {
          in: ["RENEWAL_PAUSED", "RENEWAL_RESUMED", "RENEWAL_CANCELLED"]
        }
      },
      orderBy: { createdAt: "asc" }
    });
    expect(
      statusActivities.map(({ action, metadata }) => ({ action, metadata }))
    ).toEqual([
      {
        action: "RENEWAL_PAUSED",
        metadata: { renewalId: renewal.id }
      },
      {
        action: "RENEWAL_RESUMED",
        metadata: { renewalId: renewal.id }
      },
      {
        action: "RENEWAL_CANCELLED",
        metadata: { renewalId: renewal.id }
      }
    ]);
  });

  it("deletes a renewal while preserving its generated transaction through SET NULL", async () => {
    const renewal = await createDirectRenewal();
    const generated = await prisma.transaction.create({
      data: {
        userId: fixtures.context.userA.id,
        type: TransactionType.EXPENSE,
        amount: "100.00",
        title: "Preserved generated transaction",
        transactionDate: new Date("2026-07-30T00:00:00.000Z"),
        fromMoneySourceId: fixtures.sourceAId,
        recurringPaymentId: renewal.id
      }
    });

    await expect(deleteRenewal(renewal.id)).resolves.toEqual({ ok: true });
    await expect(
      prisma.recurringPayment.count({ where: { id: renewal.id } })
    ).resolves.toBe(0);
    await expect(
      prisma.transaction.findUniqueOrThrow({ where: { id: generated.id } })
    ).resolves.toMatchObject({ recurringPaymentId: null });
    const activity = await prisma.activityLog.findFirstOrThrow({
      where: {
        userId: fixtures.context.userA.id,
        action: "RENEWAL_DELETED",
        entityId: renewal.id
      }
    });
    expect(activity.metadata).toEqual({
      renewalId: renewal.id,
      title: renewal.title
    });
  });
});

describe("renewal ownership and atomicity", () => {
  it("rejects every poisoned foreign transaction reference before mark-paid writes", async () => {
    const [foreignCategory, foreignProject] = await prisma.$transaction([
      prisma.category.create({
        data: {
          userId: fixtures.context.userB.id,
          name: `Foreign renewal category ${randomUUID()}`,
          type: CategoryType.EXPENSE
        }
      }),
      prisma.financialProject.create({
        data: {
          userId: fixtures.context.userB.id,
          name: `Foreign renewal project ${randomUUID()}`
        }
      })
    ]);
    const cases = [
      {
        field: "categoryId",
        renewal: await createDirectRenewal(),
        poison: { categoryId: foreignCategory.id }
      },
      {
        field: "projectId",
        renewal: await createDirectRenewal(),
        poison: { projectId: foreignProject.id }
      },
      {
        field: "fromMoneySourceId",
        renewal: await createDirectRenewal(),
        poison: { fromMoneySourceId: fixtures.sourceBId }
      },
      {
        field: "toMoneySourceId",
        renewal: await createDirectRenewal(fixtures.context.userA.id, {
          transactionType: TransactionType.INCOME,
          fromMoneySourceId: null,
          toMoneySourceId: fixtures.sourceAId
        }),
        poison: { toMoneySourceId: fixtures.sourceBId }
      }
    ] as const;

    for (const { field, renewal, poison } of cases) {
      await prisma.recurringPayment.update({
        where: { id: renewal.id },
        data: poison
      });
      const before = await Promise.all([
        prisma.transaction.count({
          where: { recurringPaymentId: renewal.id }
        }),
        prisma.activityLog.count({ where: { entityId: renewal.id } })
      ]);

      await expect(markRenewalAsPaid(renewal.id), field).rejects.toThrow(
        /Referenced (record|money source) not found\./
      );

      await expect(
        prisma.recurringPayment.findUniqueOrThrow({
          where: { id: renewal.id }
        })
      ).resolves.toMatchObject({
        ...poison,
        nextDueDate: renewal.nextDueDate,
        lastGeneratedDate: null
      });
      await expect(
        Promise.all([
          prisma.transaction.count({
            where: { recurringPaymentId: renewal.id }
          }),
          prisma.activityLog.count({ where: { entityId: renewal.id } })
        ])
      ).resolves.toEqual(before);
    }
  }, 30_000);

  it("does not reveal or mutate another user's renewal through reads or mutations", async () => {
    const renewal = await createDirectRenewal(fixtures.context.userB.id);
    const before = await Promise.all([
      prisma.transaction.count({
        where: { userId: fixtures.context.userA.id }
      }),
      prisma.activityLog.count({ where: { entityId: renewal.id } })
    ]);

    await expect(getRenewal(renewal.id)).rejects.toThrow("Renewal not found.");
    for (const mutate of [
      () => updateRenewal(renewal.id, { title: "Forbidden" }),
      () => markRenewalAsPaid(renewal.id),
      () => skipRenewalCycle(renewal.id),
      () => pauseRenewal(renewal.id),
      () => resumeRenewal(renewal.id),
      () => cancelRenewal(renewal.id),
      () => deleteRenewal(renewal.id)
    ]) {
      await expect(mutate()).rejects.toThrow("Renewal not found.");
    }

    const visible = await listRenewals();
    expect(visible.some(({ id }) => id === renewal.id)).toBe(false);
    await expect(
      prisma.recurringPayment.findUniqueOrThrow({ where: { id: renewal.id } })
    ).resolves.toMatchObject({
      userId: fixtures.context.userB.id,
      title: renewal.title,
      status: RenewalStatus.ACTIVE
    });
    await expect(
      Promise.all([
        prisma.transaction.count({
          where: { userId: fixtures.context.userA.id }
        }),
        prisma.activityLog.count({ where: { entityId: renewal.id } })
      ])
    ).resolves.toEqual(before);
  });

  it("rolls back every renewal mutation when its activity write fails", async () => {
    const updateTarget = await createDirectRenewal();
    const paidTarget = await createDirectRenewal();
    const skipTarget = await createDirectRenewal();
    const statusTarget = await createDirectRenewal();
    const deleteTarget = await createDirectRenewal();
    const createTitle = `Rolled back create ${randomUUID()}`;
    const uninstallFailure = await installActivityFailure(
      fixtures.context.userA.id
    );

    try {
      await expect(
        createRenewal({
          title: createTitle,
          amount: 10,
          transactionType: TransactionType.EXPENSE,
          fromMoneySourceId: fixtures.sourceAId,
          frequency: RenewalFrequency.MONTHLY,
          nextDueDate: new Date("2026-07-30T00:00:00.000Z")
        })
      ).rejects.toThrow();
      await expect(
        updateRenewal(updateTarget.id, { title: "Rolled back update" })
      ).rejects.toThrow();
      await expect(markRenewalAsPaid(paidTarget.id)).rejects.toThrow();
      await expect(skipRenewalCycle(skipTarget.id)).rejects.toThrow();
      await expect(pauseRenewal(statusTarget.id)).rejects.toThrow();
      await expect(deleteRenewal(deleteTarget.id)).rejects.toThrow();
    } finally {
      await uninstallFailure();
    }

    const [createCount, updatePersisted, paidPersisted, paidCount, skipPersisted] =
      await Promise.all([
        prisma.recurringPayment.count({
          where: { userId: fixtures.context.userA.id, title: createTitle }
        }),
        prisma.recurringPayment.findUniqueOrThrow({
          where: { id: updateTarget.id }
        }),
        prisma.recurringPayment.findUniqueOrThrow({
          where: { id: paidTarget.id }
        }),
        prisma.transaction.count({
          where: { recurringPaymentId: paidTarget.id }
        }),
        prisma.recurringPayment.findUniqueOrThrow({
          where: { id: skipTarget.id }
        })
      ]);
    expect(createCount).toBe(0);
    expect(updatePersisted.title).toBe(updateTarget.title);
    expect(paidPersisted).toMatchObject({
      nextDueDate: paidTarget.nextDueDate,
      lastGeneratedDate: null
    });
    expect(paidCount).toBe(0);
    expect(skipPersisted.nextDueDate).toEqual(skipTarget.nextDueDate);
    await expect(
      prisma.recurringPayment.findUniqueOrThrow({
        where: { id: statusTarget.id }
      })
    ).resolves.toMatchObject({ status: RenewalStatus.ACTIVE });
    await expect(
      prisma.recurringPayment.count({ where: { id: deleteTarget.id } })
    ).resolves.toBe(1);
  }, 30_000);
});
