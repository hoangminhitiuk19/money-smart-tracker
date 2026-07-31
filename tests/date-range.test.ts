import { describe, expect, it } from "vitest";
import {
  exclusiveDayAfter,
  parseTransactionDateRange,
  startOfDate,
  transactionDateRange
} from "@/lib/date-range";

describe("transaction date ranges", () => {
  it("uses the UTC start of the following day as an inclusive end boundary", () => {
    expect(transactionDateRange("2026-07-01", "2026-07-30")).toStrictEqual({
      gte: new Date("2026-07-01T00:00:00.000Z"),
      lt: new Date("2026-07-31T00:00:00.000Z")
    });
  });

  it("normalizes date-only strings to UTC calendar boundaries", () => {
    expect(startOfDate("2026-07-30")).toStrictEqual(
      new Date("2026-07-30T00:00:00.000Z")
    );
    expect(exclusiveDayAfter("2026-07-30")).toStrictEqual(
      new Date("2026-07-31T00:00:00.000Z")
    );
  });

  it("uses the local calendar day of a locally constructed Date", () => {
    expect(
      transactionDateRange(new Date(2026, 6, 1), new Date(2026, 6, 30))
    ).toStrictEqual({
      gte: new Date("2026-07-01T00:00:00.000Z"),
      lt: new Date("2026-07-31T00:00:00.000Z")
    });
  });

  it("omits a boundary that the caller did not supply", () => {
    expect(transactionDateRange(undefined, "2026-07-30")).toStrictEqual({
      lt: new Date("2026-07-31T00:00:00.000Z")
    });
  });

  it.each(["", "2026-02-30", "not-a-date"])(
    "rejects an invalid date-only boundary: %s",
    (input) => {
      expect(parseTransactionDateRange(input)).toStrictEqual({
        ok: false,
        error: "Date filters must use valid YYYY-MM-DD calendar dates."
      });
    }
  );
});
