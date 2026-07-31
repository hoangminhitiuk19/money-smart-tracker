import { describe, expect, it } from "vitest";
import {
  formatUserDate,
  formatUserMoney,
  type UserFormatSettings
} from "@/lib/user-format";

const commaSettings: UserFormatSettings = {
  defaultCurrency: "VND",
  dateFormat: "DD/MM/YYYY",
  numberFormat: "1,000,000"
};

const dotSettings: UserFormatSettings = {
  defaultCurrency: "VND",
  dateFormat: "YYYY-MM-DD",
  numberFormat: "1.000.000"
};

describe("persisted user formatting", () => {
  it("formats values beyond Number.MAX_SAFE_INTEGER without losing Decimal cents", () => {
    expect(
      formatUserMoney("9007199254740991.99", "USD", commaSettings)
    ).toContain("9,007,199,254,740,991.99");
  });

  it("uses the persisted dot grouping format", () => {
    expect(formatUserMoney("1000000", "VND", dotSettings)).toContain(
      "1.000.000"
    );
  });

  it("uses the value currency instead of the default currency", () => {
    const formatted = formatUserMoney("12.50", "USD", commaSettings);

    expect(formatted).toContain("$");
    expect(formatted).not.toContain("₫");
  });

  it.each([
    ["DD/MM/YYYY", "30/07/2026"],
    ["MM/DD/YYYY", "07/30/2026"],
    ["YYYY-MM-DD", "2026-07-30"]
  ] as const)("formats a date-only string as %s", (dateFormat, expected) => {
    expect(
      formatUserDate("2026-07-30", {
        ...commaSettings,
        dateFormat
      })
    ).toBe(expected);
  });

  it("uses UTC calendar fields for persisted date-only Date values", () => {
    expect(
      formatUserDate(
        new Date("2026-07-30T00:00:00.000Z"),
        commaSettings
      )
    ).toBe("30/07/2026");
  });
});
