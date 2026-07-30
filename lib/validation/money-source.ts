import {
  CardNetwork,
  FeeFrequency,
  MoneySourceType,
  Prisma,
  WaiverPeriod
} from "@prisma/client";
import { z } from "zod";

const nullableTextSchema = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((value) => (value === "" ? null : value));

const currencySchema = z.string().trim().min(1);

const decimalValueSchema = z
  .union([z.string(), z.number(), z.instanceof(Prisma.Decimal)])
  .transform((value, context) => {
    const text = typeof value === "string" ? value.trim() : value.toString();
    const validation = z.coerce.number().finite().safeParse(text);

    if (!text || !validation.success) {
      context.addIssue({
        code: "custom",
        message: "Enter a valid decimal amount."
      });
      return z.NEVER;
    }

    try {
      new Prisma.Decimal(text);
    } catch {
      context.addIssue({
        code: "custom",
        message: "Enter a valid decimal amount."
      });
      return z.NEVER;
    }

    return text;
  });

const nonNegativeDecimalSchema = decimalValueSchema.refine(
  (value) => new Prisma.Decimal(value).greaterThanOrEqualTo(0),
  "Amount must not be negative."
);

function parseCalendarDate(value: string | Date) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null;
}

const nullableDateSchema = z
  .union([z.string(), z.date()])
  .transform((value, context) => {
    const date = parseCalendarDate(value);

    if (!date) {
      context.addIssue({
        code: "custom",
        message: "Enter a valid YYYY-MM-DD calendar date."
      });
      return z.NEVER;
    }

    return date;
  })
  .nullable()
  .optional();

const nullableCardDaySchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(31)
  .nullable()
  .optional();

const nullableFreeYearsSchema = z.coerce
  .number()
  .int()
  .min(0)
  .max(100)
  .nullable()
  .optional();

const moneySourceShape = {
  name: z.string().trim().min(1),
  type: z.nativeEnum(MoneySourceType),
  providerName: nullableTextSchema,
  displayIdentifier: nullableTextSchema,
  currency: currencySchema,
  openingBalance: decimalValueSchema,
  description: nullableTextSchema,
  isActive: z.boolean(),
  cardLastFourDigits: z
    .string()
    .trim()
    .regex(/^\d{2,6}$/)
    .nullable()
    .optional(),
  cardNetwork: z.nativeEnum(CardNetwork).nullable().optional(),
  openedDate: nullableDateSchema,
  creditLimit: nonNegativeDecimalSchema.nullable().optional(),
  initialOutstandingDebt: nonNegativeDecimalSchema,
  initialCardCredit: nonNegativeDecimalSchema,
  billingCycleDay: nullableCardDaySchema,
  paymentDueDay: nullableCardDaySchema,
  hasAnnualFee: z.boolean(),
  annualFeeAmount: nonNegativeDecimalSchema.nullable().optional(),
  annualFeeCurrency: currencySchema,
  annualFeeChargeDate: nullableDateSchema,
  annualFeeFrequency: z.nativeEnum(FeeFrequency).nullable().optional(),
  firstYearFeeWaived: z.boolean(),
  freeYearsCount: nullableFreeYearsSchema,
  feeWaivedUntilDate: nullableDateSchema,
  annualFeeWaiverEnabled: z.boolean(),
  annualFeeWaiverSpendTarget: nonNegativeDecimalSchema.nullable().optional(),
  annualFeeWaiverPeriod: z.nativeEnum(WaiverPeriod).nullable().optional(),
  waiverPeriodStartDate: nullableDateSchema,
  waiverPeriodEndDate: nullableDateSchema,
  annualFeeWaiverNote: nullableTextSchema
};

const createMoneySourceBaseSchema = z.object({
  ...moneySourceShape,
  currency: currencySchema.default("VND"),
  openingBalance: decimalValueSchema.default("0"),
  isActive: z.boolean().default(true),
  initialOutstandingDebt: nonNegativeDecimalSchema.default("0"),
  initialCardCredit: nonNegativeDecimalSchema.default("0"),
  hasAnnualFee: z.boolean().default(false),
  annualFeeCurrency: currencySchema.default("VND"),
  firstYearFeeWaived: z.boolean().default(false),
  annualFeeWaiverEnabled: z.boolean().default(false)
});

const updateMoneySourceBaseSchema = z.object(moneySourceShape).partial();

type CreateMoneySourceData = z.output<typeof createMoneySourceBaseSchema>;
type UpdateMoneySourceData = z.output<typeof updateMoneySourceBaseSchema>;
type ValidationData = CreateMoneySourceData | UpdateMoneySourceData;

const nullableCardConfigurationFields = [
  "cardLastFourDigits",
  "cardNetwork",
  "openedDate",
  "creditLimit",
  "billingCycleDay",
  "paymentDueDay",
  "annualFeeAmount",
  "annualFeeChargeDate",
  "annualFeeFrequency",
  "freeYearsCount",
  "feeWaivedUntilDate",
  "annualFeeWaiverSpendTarget",
  "annualFeeWaiverPeriod",
  "waiverPeriodStartDate",
  "waiverPeriodEndDate",
  "annualFeeWaiverNote"
] as const;

function hasNonCardConfiguration(data: ValidationData) {
  if (
    nullableCardConfigurationFields.some(
      (field) => data[field] !== undefined && data[field] !== null
    )
  ) {
    return true;
  }

  if (
    data.initialOutstandingDebt !== undefined &&
    new Prisma.Decimal(data.initialOutstandingDebt).greaterThan(0)
  ) {
    return true;
  }

  if (
    data.initialCardCredit !== undefined &&
    new Prisma.Decimal(data.initialCardCredit).greaterThan(0)
  ) {
    return true;
  }

  return (
    data.hasAnnualFee === true ||
    data.firstYearFeeWaived === true ||
    data.annualFeeWaiverEnabled === true ||
    (data.annualFeeCurrency !== undefined &&
      data.annualFeeCurrency !== "VND")
  );
}

function addRequiredIssue(
  context: z.RefinementCtx,
  data: ValidationData,
  field:
    | "annualFeeAmount"
    | "annualFeeFrequency"
    | "annualFeeChargeDate"
    | "annualFeeWaiverSpendTarget"
    | "annualFeeWaiverPeriod"
    | "waiverPeriodStartDate"
    | "waiverPeriodEndDate"
) {
  if (data[field] === undefined || data[field] === null) {
    context.addIssue({
      code: "custom",
      message: "This field is required when the related tracking is enabled.",
      path: [field]
    });
  }
}

function validateMoneySourceConfiguration(
  data: ValidationData,
  context: z.RefinementCtx
) {
  if (
    data.type !== undefined &&
    data.type !== MoneySourceType.CREDIT_CARD &&
    hasNonCardConfiguration(data)
  ) {
    context.addIssue({
      code: "custom",
      message: "Card configuration is only valid for credit cards.",
      path: ["type"]
    });
  }

  if (data.hasAnnualFee === true) {
    addRequiredIssue(context, data, "annualFeeAmount");
    addRequiredIssue(context, data, "annualFeeFrequency");
    addRequiredIssue(context, data, "annualFeeChargeDate");
  }

  if (data.annualFeeWaiverEnabled === true) {
    addRequiredIssue(context, data, "annualFeeWaiverSpendTarget");
    addRequiredIssue(context, data, "annualFeeWaiverPeriod");
    addRequiredIssue(context, data, "waiverPeriodStartDate");
    addRequiredIssue(context, data, "waiverPeriodEndDate");

    if (
      data.annualFeeWaiverSpendTarget !== undefined &&
      data.annualFeeWaiverSpendTarget !== null &&
      new Prisma.Decimal(data.annualFeeWaiverSpendTarget).lessThanOrEqualTo(0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Waiver target must be positive.",
        path: ["annualFeeWaiverSpendTarget"]
      });
    }
  }

  if (
    data.waiverPeriodStartDate instanceof Date &&
    data.waiverPeriodEndDate instanceof Date &&
    data.waiverPeriodEndDate < data.waiverPeriodStartDate
  ) {
    context.addIssue({
      code: "custom",
      message: "Waiver period end date must not be before its start date.",
      path: ["waiverPeriodEndDate"]
    });
  }
}

export const moneySourceSchema = createMoneySourceBaseSchema.superRefine(
  validateMoneySourceConfiguration
);

export const moneySourceUpdateSchema = updateMoneySourceBaseSchema.superRefine(
  validateMoneySourceConfiguration
);

export type MoneySourceInput = z.input<typeof moneySourceSchema>;
export type MoneySourceUpdateInput = z.input<
  typeof moneySourceUpdateSchema
>;
