import { describe, expect, it } from "vitest";

import { parseSyntheticInboundMessage } from "@/lib/inbound-email/synthetic-parser";

const fixture = `MONEY SMART TRACKER TEST
Amount: 125000
Currency: VND
Date: 2026-08-10
Merchant: Demo Cafe`;

function message(text: string | null, html: string | null = null) {
  return { text, html, attachmentCount: 0 };
}

const unsupported = { kind: "unsupported", code: "UNSUPPORTED" } as const;

describe("strict synthetic inbound-email parser", () => {
  it("extracts the exact approved fixture as an ID-free EXPENSE candidate", () => {
    expect(parseSyntheticInboundMessage(message(fixture))).toEqual({
      kind: "candidate",
      candidate: {
        type: "EXPENSE",
        amountText: "125000",
        currency: "VND",
        transactionDateText: "2026-08-10",
        title: "Demo Cafe",
        description: "Synthetic inbound-email test data.",
        confidence: 100
      }
    });
  });

  it("normalizes CRLF, surrounding whitespace, and whitespace around values", () => {
    const text = `  MONEY SMART TRACKER TEST\r
Amount:   125000  \r
Currency:  VND\r
Date: 2026-08-10  \r
Merchant:   Demo Cafe  \r
`;

    expect(parseSyntheticInboundMessage(message(text))).toMatchObject({
      kind: "candidate",
      candidate: {
        amountText: "125000",
        currency: "VND",
        transactionDateText: "2026-08-10",
        title: "Demo Cafe"
      }
    });
  });

  it.each(["0", "-1", "1.234", "10000000000000000.00"])(
    "rejects a non-canonical Decimal(18,2) amount: %s",
    (amount) => {
      expect(
        parseSyntheticInboundMessage(
          message(fixture.replace("Amount: 125000", `Amount: ${amount}`))
        )
      ).toEqual(unsupported);
    }
  );

  it.each(["2026-02-30", "2026-8-10"])(
    "rejects an invalid ISO calendar date: %s",
    (date) => {
      expect(
        parseSyntheticInboundMessage(
          message(fixture.replace("Date: 2026-08-10", `Date: ${date}`))
        )
      ).toEqual(unsupported);
    }
  );

  it.each([
    ["missing field", fixture.replace("\nCurrency: VND", "")],
    [
      "duplicate field",
      fixture.replace("Merchant: Demo Cafe", "Date: 2026-08-10")
    ],
    ["extra field", `${fixture}\nNote: artificial`],
    [
      "wrong field order",
      fixture.replace(
        "Currency: VND\nDate: 2026-08-10",
        "Date: 2026-08-10\nCurrency: VND"
      )
    ],
    [
      "internal blank line",
      fixture.replace("Currency: VND", "Currency: VND\n")
    ]
  ])("rejects a %s", (_case, text) => {
    expect(parseSyntheticInboundMessage(message(text))).toEqual(unsupported);
  });

  it.each([
    fixture.replace("MONEY SMART TRACKER TEST", "money smart tracker test"),
    fixture.replace("Amount: 125000", "amount: 125000")
  ])("rejects lowercase marker or field names", (text) => {
    expect(parseSyntheticInboundMessage(message(text))).toEqual(unsupported);
  });

  it("rejects a blank merchant", () => {
    expect(
      parseSyntheticInboundMessage(
        message(fixture.replace("Merchant: Demo Cafe", "Merchant:   "))
      )
    ).toEqual(unsupported);
  });

  it("rejects a merchant beyond the existing 200-character title limit", () => {
    expect(
      parseSyntheticInboundMessage(
        message(
          fixture.replace("Demo Cafe", "A".repeat(201))
        )
      )
    ).toEqual(unsupported);
  });

  it.each(["VN", "VNDX", "vnd"])(
    "rejects an unsupported currency code: %s",
    (currency) => {
      expect(
        parseSyntheticInboundMessage(
          message(fixture.replace("Currency: VND", `Currency: ${currency}`))
        )
      ).toEqual(unsupported);
    }
  );

  it("keeps HTML-only input unsupported", () => {
    expect(parseSyntheticInboundMessage(message(null, fixture))).toEqual(
      unsupported
    );
  });

  it.each([
    "DEMO BANK TEST\nAmount: 125000\nCurrency: VND\nDate: 2026-08-10\nMerchant: Demo Cafe",
    "ARTIFICIAL OTP NOTICE\nOTP: 000000",
    "SYNTHETIC MARKETING MESSAGE\nOffer: demo only"
  ])("rejects arbitrary bank, OTP, or marketing content", (text) => {
    expect(parseSyntheticInboundMessage(message(text))).toEqual(unsupported);
  });
});
