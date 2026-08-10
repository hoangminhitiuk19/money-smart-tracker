import { describe, expect, it, vi } from "vitest";

import { ResendInboundEmailProvider } from "@/lib/inbound-email/resend-provider";

const config = {
  apiKey: "re_test_key",
  webhookSecret: "whsec_test_secret",
  domain: "demo-inbound.resend.app"
};

const signatureHeaders = new Headers({
  "svix-id": "evt_verified",
  "svix-timestamp": "1786320000",
  "svix-signature": "v1,signature"
});

const verifiedEmailEvent = {
  type: "email.received",
  created_at: "2026-08-10T00:00:00.000Z",
  data: {
    email_id: "4d51a650-e7a6-4a61-bf49-3a1cf1eaf830",
    to: ["opaque-test-alias@demo-inbound.resend.app"],
    from: "redacted@example.test",
    subject: "Synthetic test"
  }
};

function createProvider(options?: {
  verify?: (input: {
    payload: string;
    headers: { id: string; timestamp: string; signature: string };
    webhookSecret: string;
  }) => unknown;
  fetch?: typeof globalThis.fetch;
}) {
  const verify = vi.fn(options?.verify ?? (() => verifiedEmailEvent));
  const fetchMock = vi.fn(
    options?.fetch ??
      (async () =>
        new Response(
          JSON.stringify({ text: null, html: null, attachments: [] }),
          { status: 200 }
        ))
  );

  return {
    provider: new ResendInboundEmailProvider(config, {
      verify,
      fetch: fetchMock as typeof globalThis.fetch
    }),
    verify,
    fetch: fetchMock
  };
}

function expectOnlyCode(error: unknown, code: string) {
  expect(error).toEqual({ code });
  expect(error).toSatisfy(
    (value: unknown) =>
      typeof value === "object" &&
      value !== null &&
      Object.keys(value).join(",") === "code"
  );
}

describe("ResendInboundEmailProvider", () => {
  it("verifies the untouched raw body before extracting neutral notification fields", () => {
    const rawBody = '{ "data" : { "synthetic" : true }, "type":"ignored" }';
    const { provider, verify } = createProvider();

    const notification = provider.verifyNotification(rawBody, signatureHeaders);

    expect(verify).toHaveBeenCalledWith({
      payload: rawBody,
      headers: {
        id: "evt_verified",
        timestamp: "1786320000",
        signature: "v1,signature"
      },
      webhookSecret: "whsec_test_secret"
    });
    expect(notification).toEqual({
      eventId: "evt_verified",
      messageId: "4d51a650-e7a6-4a61-bf49-3a1cf1eaf830",
      recipients: ["opaque-test-alias@demo-inbound.resend.app"],
      occurredAt: new Date("2026-08-10T00:00:00.000Z")
    });
    expect(Object.keys(notification).sort()).toEqual([
      "eventId",
      "messageId",
      "occurredAt",
      "recipients"
    ]);
  });

  it.each(["svix-id", "svix-timestamp", "svix-signature"])(
    "rejects a missing %s without invoking the verifier",
    (missingHeader) => {
      const headers = new Headers(signatureHeaders);
      headers.delete(missingHeader);
      const { provider, verify } = createProvider();

      const error = (() => {
        try {
          provider.verifyNotification("{}", headers);
        } catch (caught) {
          return caught;
        }
      })();

      expectOnlyCode(error, "INVALID_SIGNATURE");
      expect(verify).not.toHaveBeenCalled();
    }
  );

  it("maps verifier failures to a data-free signature error", () => {
    const { provider } = createProvider({
      verify: () => {
        throw new Error("synthetic verifier detail");
      }
    });

    let error: unknown;
    try {
      provider.verifyNotification("private synthetic body", signatureHeaders);
    } catch (caught) {
      error = caught;
    }

    expectOnlyCode(error, "INVALID_SIGNATURE");
  });

  it("maps hostile access to a verified payload to a data-free notification error", () => {
    const verifiedPayload = new Proxy(
      {},
      {
        get() {
          throw new Error("synthetic verified payload private detail");
        }
      }
    );
    const { provider } = createProvider({ verify: () => verifiedPayload });

    let error: unknown;
    try {
      provider.verifyNotification("{}", signatureHeaders);
    } catch (caught) {
      error = caught;
    }

    expectOnlyCode(error, "INVALID_NOTIFICATION");
  });

  it.each([
    {
      case: "non-UUID message ID",
      event: {
        ...verifiedEmailEvent,
        data: { ...verifiedEmailEvent.data, email_id: "not-a-uuid" }
      }
    },
    {
      case: "invalid timestamp",
      event: { ...verifiedEmailEvent, created_at: "not-a-timestamp" }
    },
    {
      case: "empty recipient list",
      event: {
        ...verifiedEmailEvent,
        data: { ...verifiedEmailEvent.data, to: [] }
      }
    },
    {
      case: "unbounded recipient list",
      event: {
        ...verifiedEmailEvent,
        data: {
          ...verifiedEmailEvent.data,
          to: Array.from(
            { length: 101 },
            (_, index) => `synthetic-${index}@example.test`
          )
        }
      }
    },
    {
      case: "unbounded recipient value",
      event: {
        ...verifiedEmailEvent,
        data: { ...verifiedEmailEvent.data, to: ["r".repeat(321)] }
      }
    }
  ])("rejects a verified notification with $case", ({ event }) => {
    const { provider } = createProvider({ verify: () => event });

    let error: unknown;
    try {
      provider.verifyNotification("{}", signatureHeaders);
    } catch (caught) {
      error = caught;
    }

    expectOnlyCode(error, "INVALID_NOTIFICATION");
  });

  it("accepts recipient count and value length at their exact boundaries", () => {
    const boundaryRecipient = "r".repeat(320);
    const recipients = [
      boundaryRecipient,
      ...Array.from(
        { length: 99 },
        (_, index) => `synthetic-${index}@example.test`
      )
    ];
    const { provider } = createProvider({
      verify: () => ({
        ...verifiedEmailEvent,
        data: { ...verifiedEmailEvent.data, to: recipients }
      })
    });

    expect(provider.verifyNotification("{}", signatureHeaders).recipients).toEqual(
      recipients
    );
  });

  it("rejects a verified non-email event before provider retrieval", () => {
    const unsupportedEvent = { type: "domain.updated" } as {
      type: string;
      data?: unknown;
    };
    Object.defineProperty(unsupportedEvent, "data", {
      enumerable: true,
      get() {
        throw new Error("unsupported event data must not be accessed");
      }
    });
    const { provider, fetch } = createProvider({
      verify: () => unsupportedEvent
    });

    let error: unknown;
    try {
      provider.verifyNotification("{}", signatureHeaders);
    } catch (caught) {
      error = caught;
    }

    expectOnlyCode(error, "UNSUPPORTED_EVENT");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retrieves an encoded message path with authorization and the caller abort signal", async () => {
    const signal = new AbortController().signal;
    const messageId = "synthetic/id with spaces?private=true";
    const { provider, fetch } = createProvider({
      fetch: async () =>
        new Response(
          JSON.stringify({
            text: "Synthetic plain text",
            html: "<p>Synthetic HTML</p>",
            attachments: []
          })
        )
    });

    await expect(provider.retrieveMessage(messageId, signal)).resolves.toEqual({
      text: "Synthetic plain text",
      html: "<p>Synthetic HTML</p>",
      attachmentCount: 0
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails/receiving/synthetic%2Fid%20with%20spaces%3Fprivate%3Dtrue?html_format=cid",
      {
        method: "GET",
        headers: { Authorization: "Bearer re_test_key" },
        signal
      }
    );
  });

  it("requests CID HTML so inline attachment bytes are not embedded", async () => {
    const { provider } = createProvider({
      fetch: async (input) => {
        const requestedUrl = String(input);
        const html = requestedUrl.endsWith("?html_format=cid")
          ? '<img src="cid:synthetic-inline-image">'
          : '<img src="data:image/png;base64,c3ludGhldGljLXByaXZhdGUtYnl0ZXM=">';

        return new Response(
          JSON.stringify({
            text: null,
            html,
            attachments: [{ id: "att_synthetic_inline" }]
          })
        );
      }
    });

    const message = await provider.retrieveMessage(
      "4d51a650-e7a6-4a61-bf49-3a1cf1eaf830",
      new AbortController().signal
    );

    expect(message).toEqual({
      text: null,
      html: '<img src="cid:synthetic-inline-image">',
      attachmentCount: 1
    });
    expect(message.html).not.toContain("data:image/");
  });

  it("counts attachment metadata without following attachment or raw URLs", async () => {
    const { provider, fetch } = createProvider({
      fetch: async () =>
        new Response(
          JSON.stringify({
            text: "Synthetic content",
            html: null,
            raw: { download_url: "https://files.example.test/raw-private" },
            attachments: [
              {
                id: "att_synthetic_1",
                filename: "synthetic.txt",
                download_url: "https://files.example.test/attachment-private"
              },
              {
                id: "att_synthetic_2",
                filename: null,
                download_url: "https://files.example.test/attachment-private-2"
              }
            ]
          })
        )
    });

    await expect(
      provider.retrieveMessage(
        "4d51a650-e7a6-4a61-bf49-3a1cf1eaf830",
        new AbortController().signal
      )
    ).resolves.toEqual({
      text: "Synthetic content",
      html: null,
      attachmentCount: 2
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      case: "non-success status",
      response: () =>
        new Response("synthetic provider detail", { status: 503 })
    },
    {
      case: "malformed JSON",
      response: () => new Response("{not-json", { status: 200 })
    },
    {
      case: "malformed payload",
      response: () =>
        new Response(JSON.stringify({ text: 42, html: null, attachments: [] }))
    },
    {
      case: "failed response stream",
      response: () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.error(
                new Error("synthetic response stream private detail")
              );
            }
          })
        )
    }
  ])("maps $case to a data-free provider error", async ({ response }) => {
    const { provider } = createProvider({ fetch: async () => response() });

    const error = await provider
      .retrieveMessage("4d51a650-e7a6-4a61-bf49-3a1cf1eaf830", new AbortController().signal)
      .catch((caught: unknown) => caught);

    expectOnlyCode(error, "PROVIDER_ERROR");
  });

  it("maps an aborted fetch to a data-free provider error", async () => {
    const controller = new AbortController();
    controller.abort();
    const { provider } = createProvider({
      fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
        init?.signal?.throwIfAborted();
        throw new Error("fetch should have thrown for the aborted signal");
      }
    });

    const error = await provider
      .retrieveMessage(
        "4d51a650-e7a6-4a61-bf49-3a1cf1eaf830",
        controller.signal
      )
      .catch((caught: unknown) => caught);

    expectOnlyCode(error, "PROVIDER_ERROR");
  });

  it("maps hostile access to a resolved response to a data-free provider error", async () => {
    const hostileResponse = new Proxy(
      {} as Response,
      {
        get(_target, property) {
          if (property === "ok") {
            throw new Error("synthetic response property private detail");
          }
          return undefined;
        }
      }
    );
    const { provider } = createProvider({
      fetch: async () => hostileResponse
    });

    const error = await provider
      .retrieveMessage(
        "4d51a650-e7a6-4a61-bf49-3a1cf1eaf830",
        new AbortController().signal
      )
      .catch((caught: unknown) => caught);

    expectOnlyCode(error, "PROVIDER_ERROR");
  });

  it.each([
    {
      case: "spoofs the size code",
      thrown: { code: "PAYLOAD_TOO_LARGE", privateDetail: "synthetic" }
    },
    {
      case: "traps property inspection",
      thrown: new Proxy(
        {},
        {
          has() {
            throw new Error("synthetic has trap private detail");
          },
          get() {
            throw new Error("synthetic get trap private detail");
          }
        }
      )
    }
  ])(
    "does not trust a foreign reader failure that $case",
    async ({ thrown }) => {
      const hostileResponse = new Proxy(
        {} as Response,
        {
          get(_target, property) {
            if (property === "ok") {
              return true;
            }
            if (property === "body") {
              throw thrown;
            }
            return undefined;
          }
        }
      );
      const { provider } = createProvider({
        fetch: async () => hostileResponse
      });

      const error = await provider
        .retrieveMessage(
          "4d51a650-e7a6-4a61-bf49-3a1cf1eaf830",
          new AbortController().signal
        )
        .catch((caught: unknown) => caught);

      expectOnlyCode(error, "PROVIDER_ERROR");
    }
  );

  it.each([
    {
      case: "provider response bytes",
      response: () =>
        new Response("x", {
          headers: { "content-length": "1100001" }
        })
    },
    {
      case: "combined text and HTML bytes",
      response: () =>
        new Response(
          JSON.stringify({
            text: "a".repeat(500_000),
            html: "é".repeat(250_001),
            attachments: []
          })
        )
    }
  ])("rejects oversized $case with one safe code", async ({ response }) => {
    const { provider } = createProvider({ fetch: async () => response() });

    const error = await provider
      .retrieveMessage("4d51a650-e7a6-4a61-bf49-3a1cf1eaf830", new AbortController().signal)
      .catch((caught: unknown) => caught);

    expectOnlyCode(error, "PAYLOAD_TOO_LARGE");
  });
});
