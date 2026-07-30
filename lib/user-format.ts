import { Prisma } from "@prisma/client";
import { decimal, type DecimalInput } from "@/lib/money";

export type UserFormatSettings = {
  defaultCurrency: string;
  dateFormat: "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
  numberFormat: "1,000,000" | "1.000.000";
};

function currencyFormatter(currency: string, locale: string) {
  return new Intl.NumberFormat(locale, {
    currency,
    maximumFractionDigits: 2,
    style: "currency"
  });
}

function usableCurrency(currency: string, fallback: string) {
  const normalized = currency.trim().toUpperCase();
  const normalizedFallback = fallback.trim().toUpperCase();

  for (const candidate of [normalized, normalizedFallback, "VND"]) {
    if (/^[A-Z]{3}$/.test(candidate)) {
      try {
        currencyFormatter(candidate, "en-US");
        return candidate;
      } catch {
        // Try the user's default and finally the application default.
      }
    }
  }

  return "VND";
}

export function formatUserMoney(
  value: DecimalInput,
  currency: string,
  settings: UserFormatSettings
): string {
  const locale = settings.numberFormat === "1.000.000" ? "de-DE" : "en-US";
  const resolvedCurrency = usableCurrency(currency, settings.defaultCurrency);
  const formatter = currencyFormatter(resolvedCurrency, locale);
  const rounded = decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const negative = rounded.isNegative() && !rounded.isZero();
  const [integer, fixedFraction = ""] = rounded.abs().toFixed(2).split(".");
  const minimumFractionDigits =
    formatter.resolvedOptions().minimumFractionDigits ?? 0;
  let fraction = fixedFraction;

  while (
    fraction.length > minimumFractionDigits &&
    fraction.endsWith("0")
  ) {
    fraction = fraction.slice(0, -1);
  }

  const groupSeparator = settings.numberFormat === "1.000.000" ? "." : ",";
  const decimalSeparator = settings.numberFormat === "1.000.000" ? "," : ".";
  const groupedInteger = integer.replace(
    /\B(?=(\d{3})+(?!\d))/g,
    groupSeparator
  );
  const exactNumber = fraction
    ? `${groupedInteger}${decimalSeparator}${fraction}`
    : groupedInteger;
  let insertedNumber = false;

  return formatter
    .formatToParts(negative ? -1 : 1)
    .map((part) => {
      if (part.type === "integer" && !insertedNumber) {
        insertedNumber = true;
        return exactNumber;
      }

      if (
        part.type === "integer" ||
        part.type === "group" ||
        part.type === "decimal" ||
        part.type === "fraction"
      ) {
        return "";
      }

      return part.value;
    })
    .join("");
}

function dateParts(value: Date | string) {
  const dateOnly =
    typeof value === "string"
      ? /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value)
      : null;

  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const date = new Date(Date.UTC(year, month - 1, day));

    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    ) {
      return { day, month, year };
    }
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return {
    day: date.getUTCDate(),
    month: date.getUTCMonth() + 1,
    year: date.getUTCFullYear()
  };
}

export function formatUserDate(
  value: Date | string,
  settings: UserFormatSettings
): string {
  const parts = dateParts(value);
  if (!parts) {
    return "Invalid date";
  }

  const day = String(parts.day).padStart(2, "0");
  const month = String(parts.month).padStart(2, "0");
  const year = String(parts.year);

  if (settings.dateFormat === "MM/DD/YYYY") {
    return `${month}/${day}/${year}`;
  }

  if (settings.dateFormat === "YYYY-MM-DD") {
    return `${year}-${month}-${day}`;
  }

  return `${day}/${month}/${year}`;
}
