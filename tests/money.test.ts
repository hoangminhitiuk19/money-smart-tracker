import { describe, expect, it } from "vitest";
import { money, sumMoney } from "@/lib/money";

describe("money", () => {
  it("preserves cents above Number.MAX_SAFE_INTEGER", () => {
    expect(
      money("90071992547409.99").plus(money("0.01")).toFixed(2)
    ).toBe("90071992547410.00");
  });

  it("adds decimal cents exactly", () => {
    expect(sumMoney(["0.10", "0.20"]).toFixed(2)).toBe("0.30");
  });
});
