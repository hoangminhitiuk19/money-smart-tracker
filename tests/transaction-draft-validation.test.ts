import {
  AdjustmentDirection,
  AdjustmentTarget,
  MoneySourceType,
  QualityRating,
  TransactionDraftOrigin,
  TransactionDraftStatus,
  TransactionType,
  type TransactionDraft
} from "@prisma/client";
import { describe, expect, it } from "vitest";
import type { OwnedTransactionReferences } from "@/lib/transactions/create";
import {
  transactionDraftInputSchema,
  transactionDraftPatchSchema,
  type TransactionDraftInput
} from "@/lib/transaction-drafts/types";
import {
  assessDraft,
  computeDraftFingerprint,
  draftToTransactionInput,
  findDuplicateDraftPositions,
  transactionDraftRecordToInput,
  transactionDraftRecordToView
} from "@/lib/transaction-drafts/validation";

const captureKey = "550e8400-e29b-41d4-a716-446655440000";

function ownedReferences(): OwnedTransactionReferences {
  return {
    categories: new Map([
      [
        "food",
        {
          defaultCountTowardFeeWaiver: true,
          defaultQualityRating: QualityRating.A
        }
      ],
      [
        "card-fee",
        {
          defaultCountTowardFeeWaiver: false,
          defaultQualityRating: QualityRating.C
        }
      ]
    ]),
    expenses: new Set(["expense-a"]),
    moneySources: new Map([
      ["bank-a", { type: MoneySourceType.BANK_ACCOUNT }],
      ["bank-b", { type: MoneySourceType.BANK_ACCOUNT }],
      ["card-a", { type: MoneySourceType.CREDIT_CARD }]
    ]),
    projects: new Set(["project-a"]),
    recurringPayments: new Set(["renewal-a"])
  };
}

function draft(
  overrides: Partial<TransactionDraftInput> = {}
): TransactionDraftInput {
  return {
    captureKey,
    position: 0,
    origin: TransactionDraftOrigin.PASTE,
    type: TransactionType.EXPENSE,
    amountText: "45.00",
    currency: "VND",
    title: "Lunch",
    description: null,
    transactionDateText: "2026-08-03",
    categoryId: null,
    qualityRating: null,
    fromMoneySourceId: "bank-a",
    toMoneySourceId: null,
    adjustedMoneySourceId: null,
    adjustmentDirection: null,
    adjustmentTarget: null,
    projectId: null,
    relatedTransactionId: null,
    countTowardFeeWaiver: null,
    countTowardFeeWaiverTouched: false,
    qualityRatingTouched: false,
    recurringPaymentId: null,
    isInstallmentRelated: false,
    duplicateConfirmed: false,
    duplicateAcknowledgementRequired: false,
    invalidMappedFields: [],
    rawRow: null,
    ...overrides
  };
}

function record(
  overrides: Partial<TransactionDraft> = {}
): TransactionDraft {
  return {
    id: "draft-a",
    userId: "user-a",
    captureKey,
    position: 0,
    origin: TransactionDraftOrigin.PASTE,
    status: TransactionDraftStatus.NEEDS_REVIEW,
    confidence: 88,
    type: TransactionType.EXPENSE,
    amountText: "45.00",
    currency: "VND",
    title: "Lunch",
    description: null,
    transactionDateText: "2026-08-03",
    categoryId: "food",
    qualityRating: QualityRating.A,
    fromMoneySourceId: "bank-a",
    toMoneySourceId: null,
    adjustedMoneySourceId: null,
    adjustmentDirection: null,
    adjustmentTarget: null,
    projectId: null,
    relatedTransactionId: null,
    countTowardFeeWaiver: true,
    countTowardFeeWaiverTouched: false,
    qualityRatingTouched: false,
    recurringPaymentId: null,
    isInstallmentRelated: false,
    duplicateFingerprint: "a".repeat(64),
    duplicateConfirmed: false,
    duplicateAcknowledgementRequired: true,
    invalidMappedFields: [],
    validationIssues: [
      {
        field: "form",
        message: "Confirm this possible duplicate before importing."
      }
    ],
    rawRow: { Amount: "45.00" },
    importBatchId: null,
    importedTransactionId: null,
    expiresAt: new Date("2026-09-02T00:00:00.000Z"),
    createdAt: new Date("2026-08-03T00:00:00.000Z"),
    updatedAt: new Date("2026-08-03T00:00:00.000Z"),
    ...overrides
  };
}

describe("transaction draft schemas", () => {
  it("accepts bounded QUICK and PASTE inputs while preserving nullable fields", () => {
    const parsed = transactionDraftInputSchema.parse(
      draft({
        origin: TransactionDraftOrigin.QUICK,
        amountText: " 45.00 ",
        currency: null,
        description: null,
        rawRow: { Amount: "45.00" }
      })
    );

    expect(parsed).toMatchObject({
      origin: "QUICK",
      amountText: "45.00",
      currency: null,
      description: null,
      rawRow: { Amount: "45.00" }
    });
    expect(
      transactionDraftInputSchema.safeParse({ ...draft(), unexpected: true })
        .success
    ).toBe(false);
    expect(
      transactionDraftInputSchema.safeParse({
        ...draft(),
        origin: TransactionDraftOrigin.EMAIL
      }).success
    ).toBe(false);
  });

  it("allows strict patches only for mutable candidate fields", () => {
    expect(
      transactionDraftPatchSchema.parse({
        title: null,
        countTowardFeeWaiver: false,
        duplicateConfirmed: true
      })
    ).toEqual({
      title: null,
      countTowardFeeWaiver: false,
      duplicateConfirmed: true
    });
    expect(
      transactionDraftPatchSchema.safeParse({ position: 4 }).success
    ).toBe(false);
    expect(
      transactionDraftPatchSchema.safeParse({
        duplicateAcknowledgementRequired: false
      }).success
    ).toBe(false);
    expect(
      transactionDraftPatchSchema.safeParse({ invalidMappedFields: [] })
        .success
    ).toBe(false);
  });
});

describe("draft conversion and assessment", () => {
  it("keeps exact amount and date text and marks a complete expense ready", () => {
    const candidate = draft({
      amountText: "90071992547409.99",
      transactionDateText: "2026-08-03",
      fromMoneySourceId: "bank-a"
    });

    expect(draftToTransactionInput(candidate)).toMatchObject({
      amount: "90071992547409.99",
      transactionDate: "2026-08-03"
    });
    const result = assessDraft(candidate, ownedReferences());
    expect(result.status).toBe("READY");
    expect(result.input?.amount).toBe("90071992547409.99");
  });

  it("applies an owned category quality default only while quality is untouched", () => {
    expect(
      assessDraft(
        draft({ categoryId: "food", qualityRating: null }),
        ownedReferences()
      ).input?.qualityRating
    ).toBe(QualityRating.A);
    expect(
      assessDraft(
        draft({
          categoryId: "food",
          qualityRating: null,
          qualityRatingTouched: true
        }),
        ownedReferences()
      ).input?.qualityRating
    ).toBeNull();
    expect(
      assessDraft(
        draft({
          categoryId: "food",
          qualityRating: QualityRating.D,
          qualityRatingTouched: true
        }),
        ownedReferences()
      ).input?.qualityRating
    ).toBe(QualityRating.D);
  });

  it("distinguishes an untouched fee-waiver default from a manual false", () => {
    expect(
      assessDraft(
        draft({
          fromMoneySourceId: "card-a",
          countTowardFeeWaiver: false
        }),
        ownedReferences()
      ).input?.countTowardFeeWaiver
    ).toBe(true);
    expect(
      assessDraft(
        draft({
          fromMoneySourceId: "card-a",
          countTowardFeeWaiver: false,
          countTowardFeeWaiverTouched: true
        }),
        ownedReferences()
      ).input?.countTowardFeeWaiver
    ).toBe(false);
  });

  it.each([
    ["qualityRating", "quality rating"],
    ["adjustmentDirection", "adjustment direction"],
    ["adjustmentTarget", "adjustment target"]
  ] as const)(
    "keeps an invalid mapped %s value as a blocking field finding",
    (field, message) => {
      const candidate =
        field === "qualityRating"
          ? draft({ invalidMappedFields: [field] })
          : draft({
              type: TransactionType.ADJUSTMENT,
              fromMoneySourceId: null,
              adjustedMoneySourceId: "card-a",
              adjustmentDirection: AdjustmentDirection.INCREASE,
              adjustmentTarget: AdjustmentTarget.CREDIT_CARD_DEBT,
              invalidMappedFields: [field]
            });

      expect(assessDraft(candidate, ownedReferences())).toMatchObject({
        status: "NEEDS_REVIEW",
        input: null,
        issues: expect.arrayContaining([
          { field, message: expect.stringContaining(message) }
        ])
      });
    }
  );

  it.each([
    {
      name: "income",
      candidate: draft({
        type: TransactionType.INCOME,
        title: "Salary",
        fromMoneySourceId: null,
        toMoneySourceId: "bank-a"
      })
    },
    {
      name: "expense",
      candidate: draft({
        qualityRating: QualityRating.A,
        projectId: "project-a",
        recurringPaymentId: "renewal-a"
      })
    },
    {
      name: "transfer",
      candidate: draft({
        type: TransactionType.TRANSFER,
        title: "Move savings",
        fromMoneySourceId: "bank-a",
        toMoneySourceId: "bank-b"
      })
    },
    {
      name: "refund",
      candidate: draft({
        type: TransactionType.REFUND,
        title: "Returned item",
        fromMoneySourceId: null,
        toMoneySourceId: "bank-a",
        relatedTransactionId: "expense-a"
      })
    },
    {
      name: "adjustment",
      candidate: draft({
        type: TransactionType.ADJUSTMENT,
        title: "Reconcile",
        fromMoneySourceId: null,
        adjustedMoneySourceId: "bank-a",
        adjustmentDirection: AdjustmentDirection.INCREASE
      })
    }
  ])("accepts the complete $name field matrix", ({ candidate }) => {
    expect(assessDraft(candidate, ownedReferences())).toMatchObject({
      status: "READY",
      issues: []
    });
  });

  it("returns field-addressable findings for incomplete transfers", () => {
    const result = assessDraft(
      draft({
        type: TransactionType.TRANSFER,
        fromMoneySourceId: "bank-a",
        toMoneySourceId: null
      }),
      ownedReferences()
    );

    expect(result).toMatchObject({
      status: "NEEDS_REVIEW",
      input: null,
      issues: expect.arrayContaining([
        { field: "toMoneySourceId", message: expect.any(String) }
      ])
    });
  });

  it.each([
    {
      name: "income with a from source",
      candidate: draft({
        type: TransactionType.INCOME,
        toMoneySourceId: "bank-a"
      }),
      field: "fromMoneySourceId"
    },
    {
      name: "expense with a to source",
      candidate: draft({ toMoneySourceId: "bank-b" }),
      field: "toMoneySourceId"
    },
    {
      name: "transfer without a from source",
      candidate: draft({
        type: TransactionType.TRANSFER,
        fromMoneySourceId: null,
        toMoneySourceId: "bank-b"
      }),
      field: "fromMoneySourceId"
    },
    {
      name: "refund with a from source",
      candidate: draft({
        type: TransactionType.REFUND,
        toMoneySourceId: "bank-b"
      }),
      field: "fromMoneySourceId"
    },
    {
      name: "adjustment with a normal from source",
      candidate: draft({
        type: TransactionType.ADJUSTMENT,
        adjustedMoneySourceId: "bank-a",
        adjustmentDirection: AdjustmentDirection.INCREASE
      }),
      field: "fromMoneySourceId"
    }
  ] as const)("maps $name to $field", ({ candidate, field }) => {
    expect(assessDraft(candidate, ownedReferences()).issues).toEqual(
      expect.arrayContaining([{ field, message: expect.any(String) }])
    );
  });

  it("keeps canonical ownership findings field-addressable", () => {
    const result = assessDraft(
      draft({ fromMoneySourceId: "foreign-source" }),
      ownedReferences()
    );

    expect(result).toMatchObject({
      status: "NEEDS_REVIEW",
      input: null,
      issues: [
        {
          field: "fromMoneySourceId",
          message: "Referenced money source not found."
        }
      ]
    });
  });

  it("preserves unresolved reference findings when unrelated core fields are incomplete", () => {
    const result = assessDraft(
      draft({
        type: null,
        amountText: null,
        title: null,
        transactionDateText: null,
        categoryId: "unresolved:categoryId:3",
        fromMoneySourceId: "unresolved:fromMoneySourceId:2",
        projectId: "unresolved:projectId:4",
        rawRow: {
          Category: "Foreign category name",
          Source: "Foreign source name",
          Project: "Foreign project name"
        }
      }),
      ownedReferences()
    );

    expect(result).toMatchObject({
      status: "NEEDS_REVIEW",
      input: null,
      issues: expect.arrayContaining([
        { field: "type", message: expect.any(String) },
        { field: "amountText", message: expect.any(String) },
        { field: "title", message: expect.any(String) },
        { field: "transactionDateText", message: expect.any(String) },
        { field: "categoryId", message: expect.any(String) },
        { field: "fromMoneySourceId", message: expect.any(String) },
        { field: "projectId", message: expect.any(String) }
      ])
    });
    expect(JSON.stringify(result.issues)).not.toContain("Foreign category name");
    expect(JSON.stringify(result.issues)).not.toContain("Foreign source name");
    expect(JSON.stringify(result.issues)).not.toContain("Foreign project name");
  });

  it("addresses invalid core values and quality restrictions to their fields", () => {
    const invalidAmount = assessDraft(
      draft({ amountText: "0" }),
      ownedReferences()
    );
    const invalidDate = assessDraft(
      draft({ transactionDateText: "not-a-date" }),
      ownedReferences()
    );
    const invalidQuality = assessDraft(
      draft({
        type: TransactionType.INCOME,
        fromMoneySourceId: null,
        toMoneySourceId: "bank-a",
        qualityRating: QualityRating.A
      }),
      ownedReferences()
    );

    expect(invalidAmount.issues).toEqual(
      expect.arrayContaining([
        { field: "amountText", message: expect.any(String) }
      ])
    );
    expect(invalidDate.issues).toEqual(
      expect.arrayContaining([
        { field: "transactionDateText", message: expect.any(String) }
      ])
    );
    expect(invalidQuality.issues).toEqual(
      expect.arrayContaining([
        { field: "qualityRating", message: expect.any(String) }
      ])
    );
  });

  it("rejects same-source transfers and non-card adjustment targets by field", () => {
    const transfer = assessDraft(
      draft({
        type: TransactionType.TRANSFER,
        fromMoneySourceId: "bank-a",
        toMoneySourceId: "bank-a"
      }),
      ownedReferences()
    );
    const adjustment = assessDraft(
      draft({
        type: TransactionType.ADJUSTMENT,
        fromMoneySourceId: null,
        adjustedMoneySourceId: "bank-a",
        adjustmentDirection: AdjustmentDirection.INCREASE,
        adjustmentTarget: AdjustmentTarget.CARD_CREDIT
      }),
      ownedReferences()
    );

    expect(transfer.issues).toEqual(
      expect.arrayContaining([
        { field: "toMoneySourceId", message: expect.any(String) }
      ])
    );
    expect(adjustment.issues).toEqual(
      expect.arrayContaining([
        { field: "adjustmentTarget", message: expect.any(String) }
      ])
    );
  });

  it("applies credit-card target and category fee-waiver defaults", () => {
    const cardAdjustment = assessDraft(
      draft({
        type: TransactionType.ADJUSTMENT,
        fromMoneySourceId: null,
        adjustedMoneySourceId: "card-a",
        adjustmentDirection: AdjustmentDirection.DECREASE
      }),
      ownedReferences()
    );
    const eligibleExpense = assessDraft(
      draft({ fromMoneySourceId: "card-a", categoryId: "food" }),
      ownedReferences()
    );
    const excludedExpense = assessDraft(
      draft({ fromMoneySourceId: "card-a", categoryId: "card-fee" }),
      ownedReferences()
    );
    const explicitOverride = assessDraft(
      draft({
        fromMoneySourceId: "card-a",
        categoryId: "food",
        countTowardFeeWaiver: false,
        countTowardFeeWaiverTouched: true
      }),
      ownedReferences()
    );

    expect(cardAdjustment.input?.adjustmentTarget).toBe(
      AdjustmentTarget.CREDIT_CARD_DEBT
    );
    expect(eligibleExpense.input?.countTowardFeeWaiver).toBe(true);
    expect(excludedExpense.input?.countTowardFeeWaiver).toBe(false);
    expect(explicitOverride.input?.countTowardFeeWaiver).toBe(false);
  });

  it("defaults nullable currency and optional booleans through the canonical boundary", () => {
    const result = assessDraft(
      draft({
        currency: null,
        countTowardFeeWaiver: null,
        description: null,
        categoryId: null,
        projectId: null,
        recurringPaymentId: null
      }),
      ownedReferences()
    );

    expect(result).toMatchObject({
      status: "READY",
      input: {
        currency: "VND",
        countTowardFeeWaiver: false,
        description: null,
        isInstallmentRelated: false
      }
    });
  });
});

describe("draft duplicate detection", () => {
  it("computes a deterministic SHA-256 fingerprint from normalized identity fields", () => {
    const first = draft({ title: "  LUNCH  ", amountText: "45.00" });
    const normalized = draft({ title: "lunch", amountText: "45.00" });
    const differentText = draft({ title: "lunch", amountText: "45.0" });
    const differentSource = draft({
      title: "lunch",
      amountText: "45.00",
      fromMoneySourceId: "bank-b"
    });

    expect(computeDraftFingerprint(first)).toBe(
      "47aabe14d3322f70f32902070a2051cda2b5d6bc69dec8dd068f19d86bb96936"
    );
    expect(computeDraftFingerprint(first)).toBe(
      computeDraftFingerprint(normalized)
    );
    expect(computeDraftFingerprint(first)).not.toBe(
      computeDraftFingerprint(differentText)
    );
    expect(computeDraftFingerprint(first)).not.toBe(
      computeDraftFingerprint(differentSource)
    );
    expect(computeDraftFingerprint(draft({ title: null }))).toBeNull();
  });

  it("marks only later numeric positions when rows arrive out of order", () => {
    const later = draft({ position: 9 });
    const earlier = draft({ position: 4 });
    const otherDate = draft({
      position: 10,
      transactionDateText: "2026-08-04"
    });

    expect(findDuplicateDraftPositions([later, earlier, otherDate])).toEqual(
      new Set([9])
    );
  });

  it("rejects rows from mixed capture sessions", () => {
    const otherCapture = draft({
      captureKey: "95cf7e69-b914-4b8e-b90a-59d7691cc32f",
      position: 1,
      transactionDateText: "2026-08-04"
    });

    expect(() =>
      findDuplicateDraftPositions([draft({ position: 1 }), otherCapture])
    ).toThrow(/capture session/i);
  });

  it("requires explicit confirmation before a repeated row becomes ready", () => {
    const candidate = draft({ position: 1 });

    expect(
      assessDraft(candidate, ownedReferences(), { possibleDuplicate: true })
    ).toMatchObject({
      status: "NEEDS_REVIEW",
      input: null,
      issues: expect.arrayContaining([
        { field: "form", message: expect.stringMatching(/duplicate/i) }
      ])
    });
    expect(
      assessDraft(
        { ...candidate, duplicateConfirmed: true },
        ownedReferences(),
        { possibleDuplicate: true }
      )
    ).toMatchObject({ status: "READY", issues: [] });
  });
});

describe("stored draft serialization", () => {
  it("converts Prisma records into exact draft inputs", () => {
    expect(transactionDraftRecordToInput(record())).toEqual(
      draft({
        categoryId: "food",
        qualityRating: QualityRating.A,
        countTowardFeeWaiver: true,
        duplicateAcknowledgementRequired: true,
        rawRow: { Amount: "45.00" }
      })
    );
  });

  it("returns a serializable view and decodes only valid stored findings", () => {
    const view = transactionDraftRecordToView(record());

    expect(view).toMatchObject({
      id: "draft-a",
      status: "NEEDS_REVIEW",
      issues: [
        {
          field: "form",
          message: "Confirm this possible duplicate before importing."
        }
      ],
      expiresAt: "2026-09-02T00:00:00.000Z",
      possibleDuplicate: true
    });
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);

    const malformed = transactionDraftRecordToView(
      record({
        validationIssues: { unsafe: true },
        duplicateAcknowledgementRequired: false,
        rawRow: ["not", "a", "record"]
      })
    );
    expect(malformed.issues).toEqual([]);
    expect(malformed.rawRow).toBeNull();
    expect(malformed.possibleDuplicate).toBe(false);
  });
});
