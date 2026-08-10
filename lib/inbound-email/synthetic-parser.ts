import { parseTransactionDateRange } from "@/lib/date-range";
import { parseTransactionCreateInput } from "@/lib/transactions/create";
import type {
  InboundMessage,
  SyntheticParseResult
} from "@/lib/inbound-email/types";

const marker = "MONEY SMART TRACKER TEST";
const description = "Synthetic inbound-email test data." as const;
const maximumMerchantLength = 200;

function unsupported(): SyntheticParseResult {
  return { kind: "unsupported", code: "UNSUPPORTED" };
}

function fieldValue(line: string, field: string): string | null {
  const prefix = `${field}:`;
  if (!line.startsWith(prefix)) {
    return null;
  }

  return line.slice(prefix.length).trim();
}

export function parseSyntheticInboundMessage(
  message: InboundMessage
): SyntheticParseResult {
  if (message.text === null) {
    return unsupported();
  }

  const lines = message.text.replace(/\r\n/g, "\n").trim().split("\n");
  if (
    lines.length !== 5 ||
    lines.some((line) => line.trim().length === 0) ||
    lines[0] !== marker
  ) {
    return unsupported();
  }

  const amountText = fieldValue(lines[1], "Amount");
  const currency = fieldValue(lines[2], "Currency");
  const transactionDateText = fieldValue(lines[3], "Date");
  const title = fieldValue(lines[4], "Merchant");

  if (
    !amountText ||
    !currency ||
    !transactionDateText ||
    !title ||
    !/^[A-Z]{3}$/.test(currency) ||
    title.length > maximumMerchantLength
  ) {
    return unsupported();
  }

  if (!parseTransactionDateRange(transactionDateText, transactionDateText).ok) {
    return unsupported();
  }

  const amountProbe = parseTransactionCreateInput({
    type: "EXPENSE",
    amount: amountText,
    currency,
    title,
    description,
    transactionDate: transactionDateText,
    categoryId: null,
    qualityRating: null,
    fromMoneySourceId: "synthetic-probe",
    toMoneySourceId: null,
    adjustedMoneySourceId: null,
    adjustmentDirection: null,
    adjustmentTarget: null,
    projectId: null,
    relatedTransactionId: null,
    countTowardFeeWaiver: false,
    recurringPaymentId: null,
    isInstallmentRelated: false
  });

  if (!amountProbe.ok) {
    return unsupported();
  }

  return {
    kind: "candidate",
    candidate: {
      type: "EXPENSE",
      amountText,
      currency,
      transactionDateText,
      title,
      description,
      confidence: 100
    }
  };
}
