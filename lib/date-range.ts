function parseDateOnly(input: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);

  if (!match) {
    return undefined;
  }

  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  );

  return date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3])
    ? date
    : new Date(Number.NaN);
}

export const INVALID_TRANSACTION_DATE_RANGE_ERROR =
  "Date filters must use valid YYYY-MM-DD calendar dates.";

function isValidDateInput(input: Date | string) {
  if (input instanceof Date) {
    return !Number.isNaN(input.getTime());
  }

  const date = parseDateOnly(input);
  return date !== undefined && !Number.isNaN(date.getTime());
}

function createTransactionDateRange(
  start?: Date | string,
  inclusiveEnd?: Date | string
) {
  return {
    ...(start ? { gte: startOfDate(start) } : {}),
    ...(inclusiveEnd ? { lt: exclusiveDayAfter(inclusiveEnd) } : {})
  };
}

export function parseTransactionDateRange(
  start?: Date | string,
  inclusiveEnd?: Date | string
):
  | { ok: true; range: { gte?: Date; lt?: Date } }
  | { ok: false; error: string } {
  if (
    (start !== undefined && !isValidDateInput(start)) ||
    (inclusiveEnd !== undefined && !isValidDateInput(inclusiveEnd))
  ) {
    return { ok: false, error: INVALID_TRANSACTION_DATE_RANGE_ERROR };
  }

  return { ok: true, range: createTransactionDateRange(start, inclusiveEnd) };
}

export function startOfDate(input: Date | string): Date {
  if (input instanceof Date) {
    return new Date(
      Date.UTC(input.getFullYear(), input.getMonth(), input.getDate())
    );
  }

  const date = parseDateOnly(input) ?? new Date(input);

  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

export function exclusiveDayAfter(input: Date | string): Date {
  const date = startOfDate(input);
  date.setUTCDate(date.getUTCDate() + 1);

  return date;
}

export function transactionDateRange(
  start?: Date | string,
  inclusiveEnd?: Date | string
): { gte?: Date; lt?: Date } {
  const result = parseTransactionDateRange(start, inclusiveEnd);

  if (!result.ok) {
    throw new Error(result.error);
  }

  return result.range;
}
