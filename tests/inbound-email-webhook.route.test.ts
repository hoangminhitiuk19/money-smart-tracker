import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  config: vi.fn(),
  createDependencies: vi.fn(),
  handle: vi.fn(),
  provider: vi.fn()
}));

vi.mock("@/lib/env", () => ({
  getInboundEmailConfig: routeMocks.config
}));

vi.mock("@/lib/inbound-email/resend-provider", () => ({
  ResendInboundEmailProvider: routeMocks.provider
}));

vi.mock("@/lib/inbound-email/webhook", () => ({
  createInboundWebhookDependencies: routeMocks.createDependencies,
  handleInboundEmailWebhook: routeMocks.handle
}));

import { POST, runtime } from "@/app/api/webhooks/inbound-email/route";

const config = {
  apiKey: "synthetic-api-key-49af9f1a",
  webhookSecret: "synthetic-webhook-secret-49af9f1a",
  domain: "inbound.audit.invalid"
};

function streamedRequest(size: number) {
  return new Request("http://localhost/api/webhooks/inbound-email", {
    method: "POST",
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(size));
        controller.close();
      }
    }),
    duplex: "half"
  } as RequestInit & { duplex: "half" });
}

describe("inbound-email webhook route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeMocks.config.mockReturnValue(config);
    routeMocks.provider.mockImplementation(function Provider() {});
    routeMocks.createDependencies.mockReturnValue({ kind: "synthetic-dependencies" });
    routeMocks.handle.mockResolvedValue({ status: 200, code: "ACCEPTED" });
  });

  it("declares the Node runtime", () => {
    expect(runtime).toBe("nodejs");
  });

  it("returns generic 503 without constructing a provider when configuration is disabled", async () => {
    routeMocks.config.mockReturnValue(null);

    const response = await POST(
      new Request("http://localhost/api/webhooks/inbound-email", {
        method: "POST",
        body: "synthetic-small-body"
      })
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      message: "Inbound email is unavailable."
    });
    expect(routeMocks.provider).not.toHaveBeenCalled();
    expect(routeMocks.handle).not.toHaveBeenCalled();
  });

  it("rejects a declared webhook body over 256 KB before orchestration", async () => {
    const response = await POST(
      new Request("http://localhost/api/webhooks/inbound-email", {
        method: "POST",
        headers: { "content-length": "256001" },
        body: "small"
      })
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ message: "Webhook request is too large." });
    expect(routeMocks.handle).not.toHaveBeenCalled();
  });

  it("rejects a streamed webhook body over 256 KB before orchestration", async () => {
    const response = await POST(streamedRequest(256_001));

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ message: "Webhook request is too large." });
    expect(routeMocks.handle).not.toHaveBeenCalled();
  });

  it("passes the untouched bounded body, headers, and configured domain", async () => {
    const rawBody = '{ "synthetic" : "49af9f1a" }';
    const request = new Request("http://localhost/api/webhooks/inbound-email", {
      method: "POST",
      headers: { "x-synthetic-signature": "present" },
      body: rawBody
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(routeMocks.handle).toHaveBeenCalledWith(
      {
        rawBody,
        headers: request.headers,
        domain: config.domain
      },
      { kind: "synthetic-dependencies" }
    );
  });

  it.each([
    [401, "INVALID", "Invalid webhook request."],
    [400, "INVALID", "Invalid webhook request."],
    [413, "OVERSIZED", "Webhook request is too large."],
    [503, "RETRY", "Inbound email is temporarily unavailable."],
    [200, "ACCEPTED", "Inbound email received."],
    [200, "IGNORED", "Inbound email received."],
    [200, "DUPLICATE", "Inbound email received."],
    [200, "OVERSIZED", "Inbound email received."]
  ] as const)(
    "maps orchestrator %s/%s to a generic response",
    async (status, code, message) => {
      routeMocks.handle.mockResolvedValueOnce({ status, code });

      const response = await POST(
        new Request("http://localhost/api/webhooks/inbound-email", {
          method: "POST",
          body: "synthetic-body-49af9f1a"
        })
      );
      const body = await response.text();

      expect(response.status).toBe(status);
      expect(JSON.parse(body)).toEqual({ message });
      expect(body).not.toContain("opaque-recipient");
      expect(body).not.toContain("user-synthetic");
      expect(body).not.toContain(config.domain);
    }
  );

  it("maps unexpected exceptions to generic 503 and logs no exception message", async () => {
    class SyntheticRouteFailure extends Error {}
    routeMocks.handle.mockRejectedValueOnce(
      new SyntheticRouteFailure("private route detail 49af9f1a")
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(
      new Request("http://localhost/api/webhooks/inbound-email", {
        method: "POST",
        body: "synthetic-body-49af9f1a"
      })
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      message: "Inbound email is temporarily unavailable."
    });
    expect(consoleError).toHaveBeenCalledWith("Inbound email webhook failed.", {
      errorClass: "SyntheticRouteFailure"
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      "private route detail"
    );
  });
});
