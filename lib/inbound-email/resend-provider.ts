import { Resend } from "resend";
import { z } from "zod";

import type { InboundEmailConfig } from "@/lib/env";
import { readBoundedResponseText } from "@/lib/inbound-email/bounded-reader";
import {
  MAX_INBOUND_CONTENT_BYTES,
  MAX_PROVIDER_RESPONSE_BYTES
} from "@/lib/inbound-email/constants";
import type {
  InboundEmailProvider,
  InboundMessage,
  InboundNotification
} from "@/lib/inbound-email/types";

type ResendWebhookVerify = (input: {
  payload: string;
  headers: { id: string; timestamp: string; signature: string };
  webhookSecret: string;
}) => unknown;

type ProviderErrorCode =
  | "INVALID_SIGNATURE"
  | "INVALID_NOTIFICATION"
  | "UNSUPPORTED_EVENT"
  | "PROVIDER_ERROR"
  | "PAYLOAD_TOO_LARGE";

const eventTypeSchema = z.object({ type: z.string() }).passthrough();

const receivedEventSchema = z
  .object({
    type: z.literal("email.received"),
    created_at: z.string().datetime({ offset: true }),
    data: z
      .object({
        email_id: z.string().uuid(),
        to: z.array(z.string().min(1).max(320)).min(1).max(100)
      })
      .passthrough()
  })
  .passthrough();

const receivedMessageSchema = z
  .object({
    text: z.string().nullable(),
    html: z.string().nullable(),
    attachments: z.array(z.unknown()).transform((items) => items.length)
  });

function safeError(code: ProviderErrorCode): { code: ProviderErrorCode } {
  return { code };
}

function defaultDependencies(config: InboundEmailConfig): {
  verify: ResendWebhookVerify;
  fetch: typeof fetch;
} {
  const resend = new Resend(config.apiKey);
  return {
    verify: resend.webhooks.verify.bind(resend.webhooks),
    fetch
  };
}

export class ResendInboundEmailProvider implements InboundEmailProvider {
  constructor(
    private readonly config: InboundEmailConfig,
    private readonly dependencies: {
      verify: ResendWebhookVerify;
      fetch: typeof fetch;
    } = defaultDependencies(config)
  ) {}

  verifyNotification(
    rawBody: string,
    headers: Headers
  ): InboundNotification {
    const id = headers.get("svix-id");
    const timestamp = headers.get("svix-timestamp");
    const signature = headers.get("svix-signature");

    if (!id || !timestamp || !signature) {
      throw safeError("INVALID_SIGNATURE");
    }

    let verified: unknown;
    try {
      verified = this.dependencies.verify({
        payload: rawBody,
        headers: { id, timestamp, signature },
        webhookSecret: this.config.webhookSecret
      });
    } catch {
      throw safeError("INVALID_SIGNATURE");
    }

    const eventType = eventTypeSchema.safeParse(verified);
    if (!eventType.success) {
      throw safeError("INVALID_NOTIFICATION");
    }
    if (eventType.data.type !== "email.received") {
      throw safeError("UNSUPPORTED_EVENT");
    }

    const event = receivedEventSchema.safeParse(verified);
    if (!event.success) {
      throw safeError("INVALID_NOTIFICATION");
    }

    return {
      eventId: id,
      messageId: event.data.data.email_id,
      recipients: event.data.data.to,
      occurredAt: new Date(event.data.created_at)
    };
  }

  async retrieveMessage(
    messageId: string,
    signal: AbortSignal
  ): Promise<InboundMessage> {
    let response: Response;
    try {
      response = await this.dependencies.fetch(
        `https://api.resend.com/emails/receiving/${encodeURIComponent(messageId)}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${this.config.apiKey}` },
          signal
        }
      );
    } catch {
      throw safeError("PROVIDER_ERROR");
    }

    if (!response.ok) {
      try {
        await response.body?.cancel();
      } catch {
        // Cancellation is best-effort; provider details remain undisclosed.
      }
      throw safeError("PROVIDER_ERROR");
    }

    let rawResponse: string;
    try {
      rawResponse = await readBoundedResponseText(
        response,
        MAX_PROVIDER_RESPONSE_BYTES
      );
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "PAYLOAD_TOO_LARGE"
      ) {
        throw safeError("PAYLOAD_TOO_LARGE");
      }
      throw safeError("PROVIDER_ERROR");
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawResponse);
    } catch {
      throw safeError("PROVIDER_ERROR");
    }

    const parsedMessage = receivedMessageSchema.safeParse(parsedJson);
    if (!parsedMessage.success) {
      throw safeError("PROVIDER_ERROR");
    }

    const { text, html, attachments: attachmentCount } = parsedMessage.data;
    const contentBytes =
      (text === null ? 0 : new TextEncoder().encode(text).byteLength) +
      (html === null ? 0 : new TextEncoder().encode(html).byteLength);

    if (contentBytes > MAX_INBOUND_CONTENT_BYTES) {
      throw safeError("PAYLOAD_TOO_LARGE");
    }

    return {
      text,
      html,
      attachmentCount
    };
  }
}
