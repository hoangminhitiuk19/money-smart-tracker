import { MoneySourceType, TransactionType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  detectColumnMapping,
  mapParsedRows,
  parsePastedTable
} from "@/lib/transaction-drafts/paste";
import { assessDraft } from "@/lib/transaction-drafts/validation";

const captureKey = "550e8400-e29b-41d4-a716-446655440000";

const mappingContext = {
  captureKey,
  defaults: {
    currency: "VND",
    transactionDateText: "2026-08-03",
    type: TransactionType.EXPENSE
  },
  categories: [
    { id: "food", name: "Food" },
    { id: "travel", name: "Travel" },
    { id: "food-duplicate", name: "FOOD" }
  ],
  moneySources: [
    { id: "vcb", name: "VCB" },
    { id: "ocb", name: "OCB" },
    { id: "hsbc", name: "HSBC" }
  ],
  projects: [{ id: "project-a", name: "Summer trip" }]
} as const;

describe("parsePastedTable", () => {
  it("parses quoted CSV and keeps amounts as strings", () => {
    const parsed = parsePastedTable(
      'Date,Title,Amount,Source\n2026-08-03,"Cafe, District 1",90071992547409.99,VCB'
    );

    expect(parsed.rows[0]).toEqual([
      "2026-08-03",
      "Cafe, District 1",
      "90071992547409.99",
      "VCB"
    ]);
  });

  it("parses TSV with Unicode headings and a quoted newline", () => {
    const parsed = parsePastedTable(
      'Ngày\tNội dung\tSố tiền\n2026-08-03\t"Cà phê\nQuận 1"\t45000'
    );

    expect(parsed).toMatchObject({
      delimiter: "\t",
      hasHeader: true,
      columns: [
        { index: 0, label: "Ngày" },
        { index: 1, label: "Nội dung" },
        { index: 2, label: "Số tiền" }
      ],
      rows: [["2026-08-03", "Cà phê\nQuận 1", "45000"]]
    });
  });

  it("keeps headerless rows and pads trailing missing cells", () => {
    const parsed = parsePastedTable("Coffee\t45\nLunch\t90\tVND");

    expect(parsed).toMatchObject({
      delimiter: "\t",
      hasHeader: false,
      columns: [
        { index: 0, label: "Column 1" },
        { index: 1, label: "Column 2" },
        { index: 2, label: "Column 3" }
      ],
      rows: [["Coffee", "45", ""], ["Lunch", "90", "VND"]]
    });
  });

  it("counts UTF-8 bytes and data rows rather than header rows", () => {
    const text = `Date\tTitle\n${Array.from(
      { length: 200 },
      (_, index) => `2026-08-03\tRow ${index + 1}`
    ).join("\n")}`;

    expect(parsePastedTable(text).rows).toHaveLength(200);
    expect(() => parsePastedTable("é".repeat(500_001))).toThrow();
  });

  it.each([
    ["oversized text", "x".repeat(1_000_001)],
    ["more than 200 rows", Array.from({ length: 201 }, () => "a\tb").join("\n")],
    ["malformed quoted input", 'Date,Title\n2026-08-03,"unterminated']
  ])("rejects %s", (_label, text) => {
    expect(() => parsePastedTable(text)).toThrow();
  });
});

describe("detectColumnMapping", () => {
  it("detects normalized Vietnamese headers", () => {
    expect(
      detectColumnMapping([
        { index: 0, label: "Ngày", samples: [] },
        { index: 1, label: "Nội dung", samples: [] },
        { index: 2, label: "Số tiền", samples: [] }
      ]).mapping
    ).toEqual({
      transactionDateText: 0,
      title: 1,
      amountText: 2
    });
  });

  it("does not guess when duplicate headers match the same field", () => {
    expect(
      detectColumnMapping([
        { index: 0, label: "Amount", samples: [] },
        { index: 1, label: "Amount", samples: [] },
        { index: 2, label: "Merchant", samples: [] }
      ])
    ).toEqual({
      mapping: { title: 2 },
      ambiguousFields: ["amountText"]
    });
  });
});

describe("mapParsedRows", () => {
  it("maps reordered source-owned names without coercing exact money text", () => {
    const table = parsePastedTable(
      "Amount,Merchant,Source,Category,Project,Date,Type\n90071992547409.99,Cafe,vcb,Travel,SUMMER TRIP,2026-08-02,expense"
    );
    const { mapping } = detectColumnMapping(table.columns);

    expect(mapParsedRows(table, mapping, mappingContext)).toEqual([
      expect.objectContaining({
        captureKey,
        position: 0,
        origin: "PASTE",
        type: TransactionType.EXPENSE,
        amountText: "90071992547409.99",
        title: "Cafe",
        transactionDateText: "2026-08-02",
        fromMoneySourceId: "vcb",
        categoryId: "travel",
        projectId: "project-a",
        currency: "VND",
        isInstallmentRelated: false,
        duplicateConfirmed: false,
        rawRow: {
          Amount: "90071992547409.99",
          Merchant: "Cafe",
          Source: "vcb",
          Category: "Travel",
          Project: "SUMMER TRIP",
          Date: "2026-08-02",
          Type: "expense"
        }
      })
    ]);
  });

  it("uses defaults only for blank mapped date, type, and currency cells", () => {
    const table = parsePastedTable(
      "Date,Type,Currency,Title,Amount,Source,Category\n,,,Coffee,45000,OCB,"
    );
    const { mapping } = detectColumnMapping(table.columns);

    expect(mapParsedRows(table, mapping, mappingContext)[0]).toMatchObject({
      transactionDateText: "2026-08-03",
      type: TransactionType.EXPENSE,
      currency: "VND",
      fromMoneySourceId: "ocb",
      categoryId: null
    });
  });

  it("maps type-specific aliases without interpreting money as a number", () => {
    const table = parsePastedTable(
      "Transaction Type,Merchant,Amount,Destination,Quality Rating,Note,Adjustment Direction,Adjustment Target,Related Transaction\nrefund,Returned order,90071992547409.99,HSBC,A,Customer returned it,Increase,Card credit,expense-a"
    );
    const { mapping } = detectColumnMapping(table.columns);

    expect(mapParsedRows(table, mapping, mappingContext)[0]).toMatchObject({
      type: TransactionType.REFUND,
      title: "Returned order",
      amountText: "90071992547409.99",
      toMoneySourceId: "hsbc",
      qualityRating: "A",
      description: "Customer returned it",
      adjustmentDirection: "INCREASE",
      adjustmentTarget: "CARD_CREDIT",
      relatedTransactionId: "expense-a"
    });
  });

  it("uses bounded unresolved IDs while retaining unmatched and ambiguous names only in rawRow", () => {
    const table = parsePastedTable(
      "Title,Amount,Source,Category,Project\nCoffee,45,Unknown,Food,Missing project"
    );
    const { mapping } = detectColumnMapping(table.columns);

    const draft = mapParsedRows(table, mapping, mappingContext)[0];

    expect(draft).toMatchObject({
      fromMoneySourceId: "unresolved:fromMoneySourceId:2",
      categoryId: "unresolved:categoryId:3",
      projectId: "unresolved:projectId:4",
      rawRow: {
        Title: "Coffee",
        Amount: "45",
        Source: "Unknown",
        Category: "Food",
        Project: "Missing project"
      }
    });

    expect(draft.fromMoneySourceId).not.toContain("Unknown");
    expect(draft.categoryId).not.toContain("Food");
    expect(draft.projectId).not.toContain("Missing project");

    const assessment = assessDraft(draft, {
      categories: new Map([["travel", { defaultCountTowardFeeWaiver: false }]]),
      expenses: new Set(),
      moneySources: new Map([
        ["vcb", { type: MoneySourceType.BANK_ACCOUNT }],
        ["ocb", { type: MoneySourceType.BANK_ACCOUNT }],
        ["hsbc", { type: MoneySourceType.BANK_ACCOUNT }]
      ]),
      projects: new Set(["project-a"]),
      recurringPayments: new Set()
    });

    expect(assessment).toMatchObject({
      status: "NEEDS_REVIEW",
      issues: expect.arrayContaining([
        { field: "fromMoneySourceId", message: expect.any(String) },
        { field: "categoryId", message: expect.any(String) },
        { field: "projectId", message: expect.any(String) }
      ])
    });
  });

  it("does not guess when each owned-name field has multiple matches", () => {
    const table = parsePastedTable(
      "Title,Amount,Source,Category,Project\nCoffee,45,VCB,Unknown category,Summer trip"
    );
    const { mapping } = detectColumnMapping(table.columns);
    const ambiguousContext = {
      ...mappingContext,
      moneySources: [
        ...mappingContext.moneySources,
        { id: "vcb-duplicate", name: "VCB" }
      ],
      projects: [
        ...mappingContext.projects,
        { id: "project-b", name: "Summer trip" }
      ]
    } as const;

    expect(mapParsedRows(table, mapping, ambiguousContext)[0]).toMatchObject({
      fromMoneySourceId: "unresolved:fromMoneySourceId:2",
      categoryId: "unresolved:categoryId:3",
      projectId: "unresolved:projectId:4",
      rawRow: {
        Source: "VCB",
        Category: "Unknown category",
        Project: "Summer trip"
      }
    });
  });

  it("retains every cell when duplicate labels need distinct raw-row keys", () => {
    const table = parsePastedTable("Title,Amount,Amount\nCoffee,45,45000");

    expect(mapParsedRows(table, { title: 0 }, mappingContext)[0]?.rawRow).toEqual({
      Title: "Coffee",
      Amount: "45",
      "Amount (2)": "45000"
    });
  });
});
