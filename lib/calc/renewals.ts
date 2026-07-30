import { RenewalFrequency } from "@prisma/client";

export type RenewalCycleInput = {
  frequency: RenewalFrequency;
  intervalCount: number;
  nextDueDate: Date;
};

function daysInMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function addCalendarInterval(
  current: Date,
  amount: number,
  unit: "month" | "year"
) {
  const originalDay = current.getUTCDate();
  const shifted = new Date(current);
  shifted.setUTCDate(1);

  if (unit === "month") {
    shifted.setUTCMonth(shifted.getUTCMonth() + amount);
  } else {
    shifted.setUTCFullYear(shifted.getUTCFullYear() + amount);
  }

  shifted.setUTCDate(
    Math.min(
      originalDay,
      daysInMonth(shifted.getUTCFullYear(), shifted.getUTCMonth())
    )
  );
  return shifted;
}

function startOfUtcDay(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

export function isUpcomingRenewal(
  renewal: {
    nextDueDate: Date;
    reminderDaysBefore: number;
  },
  today: Date = new Date()
) {
  const reminderWindowEnd = startOfUtcDay(today);
  reminderWindowEnd.setUTCDate(
    reminderWindowEnd.getUTCDate() + Math.max(0, renewal.reminderDaysBefore)
  );

  return startOfUtcDay(renewal.nextDueDate) <= reminderWindowEnd;
}

export function calculateNextDueDate(
  current: Date,
  frequency: RenewalFrequency,
  intervalCount: number
) {
  const interval = Math.max(1, intervalCount);

  if (frequency === RenewalFrequency.WEEKLY) {
    const nextDueDate = new Date(current);
    nextDueDate.setUTCDate(nextDueDate.getUTCDate() + interval * 7);
    return nextDueDate;
  }

  if (frequency === RenewalFrequency.MONTHLY) {
    return addCalendarInterval(current, interval, "month");
  }

  if (frequency === RenewalFrequency.YEARLY) {
    return addCalendarInterval(current, interval, "year");
  }

  const nextDueDate = new Date(current);
  nextDueDate.setUTCDate(nextDueDate.getUTCDate() + interval);
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
