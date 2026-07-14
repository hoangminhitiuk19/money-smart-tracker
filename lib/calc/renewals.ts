import { RenewalFrequency } from "@prisma/client";

export type RenewalCycleInput = {
  frequency: RenewalFrequency;
  intervalCount: number;
  nextDueDate: Date;
};

function daysInMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function addCalendarInterval(
  current: Date,
  amount: number,
  unit: "month" | "year"
) {
  const originalDay = current.getDate();
  const shifted = new Date(current);
  shifted.setDate(1);

  if (unit === "month") {
    shifted.setMonth(shifted.getMonth() + amount);
  } else {
    shifted.setFullYear(shifted.getFullYear() + amount);
  }

  shifted.setDate(
    Math.min(originalDay, daysInMonth(shifted.getFullYear(), shifted.getMonth()))
  );
  return shifted;
}

export function calculateNextDueDate(
  current: Date,
  frequency: RenewalFrequency,
  intervalCount: number
) {
  const interval = Math.max(1, intervalCount);

  if (frequency === RenewalFrequency.WEEKLY) {
    const nextDueDate = new Date(current);
    nextDueDate.setDate(nextDueDate.getDate() + interval * 7);
    return nextDueDate;
  }

  if (frequency === RenewalFrequency.MONTHLY) {
    return addCalendarInterval(current, interval, "month");
  }

  if (frequency === RenewalFrequency.YEARLY) {
    return addCalendarInterval(current, interval, "year");
  }

  const nextDueDate = new Date(current);
  nextDueDate.setDate(nextDueDate.getDate() + interval);
  return nextDueDate;
}

export function calculatePaidRenewalCycle(input: RenewalCycleInput) {
  return {
    createTransaction: true,
    newNextDueDate: calculateNextDueDate(
      input.nextDueDate,
      input.frequency,
      input.intervalCount
    )
  };
}

export function calculateSkippedRenewalCycle(input: RenewalCycleInput) {
  return {
    createTransaction: false,
    newNextDueDate: calculateNextDueDate(
      input.nextDueDate,
      input.frequency,
      input.intervalCount
    )
  };
}
