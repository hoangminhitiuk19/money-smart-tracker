import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getInboundEmailConfig, parseServerEnv } from "@/lib/env";

const valid = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/money",
  NEXTAUTH_SECRET: "0123456789abcdef0123456789abcdef",
  NEXTAUTH_URL: "http://localhost:3000"
} as unknown as NodeJS.ProcessEnv;

const inbound = {
  INBOUND_EMAIL_API_KEY: "re_test_key",
  INBOUND_EMAIL_WEBHOOK_SECRET: "whsec_test_secret",
  INBOUND_EMAIL_DOMAIN: "Demo-Inbound.resend.app"
};

const inboundKeys = Object.keys(inbound);
const envExample = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");
const readme = readFileSync(resolve(process.cwd(), "README.md"), "utf8");
const readmeText = readme.replace(/[`*_]/g, "").replace(/\s+/g, " ");

describe("server environment", () => {
  it("accepts exactly the required variables", () => {
    expect(parseServerEnv(valid)).toEqual(valid);
  });

  it.each(["AUTH_SECRET", "AUTH_URL"] as const)(
    "rejects forbidden alias %s even when required variables exist",
    (key) => {
      expect(() => parseServerEnv({ ...valid, [key]: "forbidden" })).toThrow(
        `Remove forbidden environment variable ${key}.`
      );
    }
  );

  it("rejects a non-PostgreSQL database URL", () => {
    expect(() =>
      parseServerEnv({ ...valid, DATABASE_URL: "https://example.com" })
    ).toThrow(/DATABASE_URL/);
  });

  it("rejects a short authentication secret", () => {
    expect(() =>
      parseServerEnv({ ...valid, NEXTAUTH_SECRET: "too-short" })
    ).toThrow(/NEXTAUTH_SECRET/);
  });

  it("rejects a relative authentication URL", () => {
    expect(() =>
      parseServerEnv({ ...valid, NEXTAUTH_URL: "/login" })
    ).toThrow(/NEXTAUTH_URL/);
  });

  it("accepts a complete inbound group and normalizes its hostname", () => {
    const parsed = parseServerEnv({ ...valid, ...inbound } as NodeJS.ProcessEnv);

    expect(getInboundEmailConfig(parsed)).toEqual({
      apiKey: "re_test_key",
      webhookSecret: "whsec_test_secret",
      domain: "demo-inbound.resend.app"
    });
  });

  it.each(Object.keys(inbound))("rejects an inbound group missing %s", (missing) => {
    const source = { ...valid, ...inbound } as Record<string, string>;
    delete source[missing];

    expect(() => parseServerEnv(source as NodeJS.ProcessEnv)).toThrow(
      /INBOUND_EMAIL_API_KEY, INBOUND_EMAIL_WEBHOOK_SECRET, INBOUND_EMAIL_DOMAIN/
    );
  });

  it.each([
    "https://demo.resend.app",
    "demo.resend.app/path",
    "user@demo.resend.app",
    "demo.resend.app:443",
    "demo..resend.app",
    "-demo.resend.app",
    "demo-.resend.app",
    `${"a".repeat(64)}.resend.app`
  ])("rejects unsafe inbound hostname %s", (domain) => {
    expect(() =>
      parseServerEnv({ ...valid, ...inbound, INBOUND_EMAIL_DOMAIN: domain })
    ).toThrow(/INBOUND_EMAIL_DOMAIN/);
  });

  it.each(["INBOUND_EMAIL_API_KEY", "INBOUND_EMAIL_WEBHOOK_SECRET"] as const)(
    "rejects an empty inbound secret %s",
    (key) => {
      expect(() => parseServerEnv({ ...valid, ...inbound, [key]: "   " })).toThrow(
        new RegExp(key)
      );
    }
  );
});

describe("inbound environment setup documentation", () => {
  it("keeps optional inbound entries commented so a copied example disables inbound email", () => {
    for (const key of inboundKeys) {
      expect(envExample).not.toMatch(new RegExp(`^${key}\\s*=`, "m"));
      expect(envExample).toMatch(new RegExp(`^#\\s*${key}\\s*=$`, "m"));
    }
  });

  it("explains that copying the example leaves inbound disabled until all three entries are uncommented", () => {
    expect(readmeText).toContain(
      "copying .env.example leaves inbound-email testing disabled"
    );
    expect(readmeText).toContain(
      "uncomment all three entries and configure them together"
    );
  });

  it("gives executable API-key and webhook signing-secret acquisition steps", () => {
    expect(readme).toContain(
      "https://resend.com/docs/dashboard/api-keys/introduction"
    );
    expect(readme).toContain(
      "https://resend.com/docs/webhooks/verify-webhooks-requests"
    );
    expect(readmeText).toContain(
      "API Keys dashboard, choose Create API Key, enter a named testing key, and choose Full access"
    );
    expect(readmeText).toContain(
      "Received-email retrieval requires API access; Sending access is insufficient"
    );
    expect(readmeText).toContain(
      "key only once, so copy it directly to Vercel"
    );
    expect(readmeText).toContain(
      "After creating the email.received webhook, open its details and copy the signing secret directly to Vercel"
    );
  });
});
