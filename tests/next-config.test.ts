import { describe, expect, it } from "vitest";

describe("Next.js security headers", () => {
  it("applies the release baseline to every route", async () => {
    const moduleUrl = new URL("../next.config.mjs", import.meta.url).href;
    const { default: nextConfig } = (await import(moduleUrl)) as {
      default: {
        headers?: () => Promise<
          Array<{
            source: string;
            headers: Array<{ key: string; value: string }>;
          }>
        >;
      };
    };
    const rules = await nextConfig.headers?.();
    expect(rules).toHaveLength(1);
    expect(rules?.[0].source).toBe("/(.*)");
    expect(Object.fromEntries(rules?.[0].headers.map(({ key, value }) => [key, value]) ?? [])).toEqual({
      "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY"
    });
  });
});
