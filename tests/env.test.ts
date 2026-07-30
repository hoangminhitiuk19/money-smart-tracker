import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@/lib/env";

const valid = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/money",
  NEXTAUTH_SECRET: "0123456789abcdef0123456789abcdef",
  NEXTAUTH_URL: "http://localhost:3000"
} as unknown as NodeJS.ProcessEnv;

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
});
