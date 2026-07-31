export const REFERENCE_DATES = {
  ledgerStart: new Date("2026-07-01T00:00:00.000Z"),
  periodEndInclusive: new Date("2026-07-31T23:59:59.999Z"),
  nextPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
  cardExpense: new Date("2026-07-10T09:00:00.000Z"),
  sameDayFirstCreatedAt: new Date("2026-07-10T09:00:01.000Z"),
  sameDaySecondCreatedAt: new Date("2026-07-10T09:00:02.000Z"),
  renewalDueDate: new Date("2026-08-02T00:00:00.000Z")
} as const;

export const REFERENCE_AMOUNTS = {
  bankOpeningBalance: "1055.00",
  investmentOpeningBalance: "800.00",
  income: "1000.00",
  eligibleCardExpense: "300.00",
  bankExpense: "140.00",
  cashTransfer: "100.00",
  walletTransfer: "250.00",
  cardPayment: "200.00",
  debtAdjustment: "15.00",
  cardCreditAdjustment: "15.00",
  rawExpense: "440.00",
  effectiveExpense: "350.00",
  linkedRefund: "90.00",
  feeWaiverTarget: "1000.00",
  goalContribution: "100.00",
  goalTarget: "500.00",
  renewal: "30.00",
  projectIncome: "900000.00",
  projectExpense: "600000.00",
  projectRefund: "100000.00"
} as const;

export const REFERENCE_EXPORT_COLUMNS = [
  "Date",
  "Type",
  "Title",
  "Amount",
  "Currency",
  "Category",
  "Quality Rating",
  "From Source",
  "To Source",
  "Project",
  "Description",
  "Count Toward Fee Waiver",
  "Created At"
] as const;

export const REFERENCE_EXPECTED_LEDGER = {
  bankBalance: "1455.00",
  cashBalance: "100.00",
  walletBalance: "250.00",
  outstandingDebt: "85.00",
  cardCredit: "15.00",
  availableCredit: "1915.00",
  netPosition: "2520.00",
  eligibleSpending: "210.00",
  feeWaiverRemaining: "790.00"
} as const;
