import { describe, expect, it } from "vitest";
import {
  generateInboundAliasLocalPart,
  inboundAddress
} from "@/lib/inbound-email/mailboxes";

describe("inbound mailbox aliases", () => {
  it("generates unique lowercase aliases with a 160-bit random payload", () => {
    const aliases = Array.from({ length: 128 }, () =>
      generateInboundAliasLocalPart()
    );

    expect(new Set(aliases)).toHaveLength(128);
    aliases.forEach((alias) => {
      expect(alias).toMatch(/^m_[0-9a-f]{40}$/);
    });
  });

  it("does not derive aliases from user identity values", () => {
    const alias = generateInboundAliasLocalPart();

    expect(alias).not.toContain("user-1");
    expect(alias).not.toContain("person@example.test");
  });

  it("normalizes the address for case-insensitive recipient comparison", () => {
    expect(
      inboundAddress(`M_${"A".repeat(40)}`, "Inbound.Example.Test")
    ).toBe(`m_${"a".repeat(40)}@inbound.example.test`);
  });
});
