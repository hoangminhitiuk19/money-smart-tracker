import { Prisma } from "@prisma/client";

export type DecimalInput = Prisma.Decimal.Value;

export function decimal(value: DecimalInput): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

export function money(value: DecimalInput): Prisma.Decimal {
  return decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function sumMoney(values: readonly DecimalInput[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>(
    (total, value) => total.plus(decimal(value)),
    decimal(0)
  );
}

export function percent(
  numerator: DecimalInput,
  denominator: DecimalInput
): Prisma.Decimal {
  const divisor = decimal(denominator);

  return divisor.isZero()
    ? decimal(0)
    : decimal(numerator).div(divisor).mul(100);
}

export function moneyText(value: DecimalInput): string {
  return money(value).toFixed(2);
}

export function presentationNumber(value: DecimalInput): number {
  return Number(decimal(value).toString());
}
