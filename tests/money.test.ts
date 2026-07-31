import { describe, expect, it } from "vitest";
import {
  clampedPresentationPercent,
  money,
  sumMoney
} from "@/lib/money";

describe("money", () => {
  it("preserves cents above Number.MAX_SAFE_INTEGER", () => {
    expect(
      money("90071992547409.99").plus(money("0.01")).toFixed(2)
    ).toBe("90071992547410.00");
  });

  it("adds decimal cents exactly", () => {
    expect(sumMoney(["0.10", "0.20"]).toFixed(2)).toBe("0.30");
  });

  it("clamps presentation percentages above 100", () => {
    expect(clampedPresentationPercent("150")).toBe(100);
  });

  it("clamps presentation percentages below 0", () => {
    expect(clampedPresentationPercent("-10")).toBe(0);
  });
});
