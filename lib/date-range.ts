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
  return {
    ...(start ? { gte: startOfDate(start) } : {}),
    ...(inclusiveEnd ? { lt: exclusiveDayAfter(inclusiveEnd) } : {})
  };
}
