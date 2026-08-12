import { getInboundEmailConfig } from "@/lib/env";
import {
  isBoundedReaderError,
  readBoundedRequestText
} from "@/lib/inbound-email/bounded-reader";
import { MAX_INBOUND_WEBHOOK_BYTES } from "@/lib/inbound-email/constants";
import { ResendInboundEmailProvider } from "@/lib/inbound-email/resend-provider";
import {
  createInboundWebhookDependencies,
  handleInboundEmailWebhook,
  type InboundWebhookResult
} from "@/lib/inbound-email/webhook";

export const runtime = "nodejs";

function safeJson(
  status: InboundWebhookResult["status"] | 408,
  message: string
) {
  return Response.json(
    { message },
    {
      status,
      headers: { "Cache-Control": "no-store" }
    }
  );
}

function genericMessage(result: InboundWebhookResult) {
  if (result.status === 200) return "Inbound email received.";
  if (result.status === 413) return "Webhook request is too large.";
  if (result.status === 503) return "Inbound email is temporarily unavailable.";
  return "Invalid webhook request.";
}

function safeErrorClass(error: unknown) {
  try {
    const name =
      error instanceof Error && typeof error.constructor?.name === "string"
        ? error.constructor.name
        : "UnknownError";
    return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name)
      ? name
      : "UnknownError";
  } catch {
    return "UnknownError";
  }
}

export async function POST(request: Request) {
  try {
    const config = getInboundEmailConfig();
    if (!config) return safeJson(503, "Inbound email is unavailable.");

    let rawBody: string;
    try {
      rawBody = await readBoundedRequestText(
        request,
        MAX_INBOUND_WEBHOOK_BYTES
      );
    } catch (error) {
      if (
        isBoundedReaderError(error) &&
        error.code === "PAYLOAD_TOO_LARGE"
      ) {
        return safeJson(413, "Webhook request is too large.");
      }
      if (
        isBoundedReaderError(error) &&
        error.code === "BODY_READ_TIMED_OUT"
      ) {
        return safeJson(408, "Webhook request timed out.");
      }
      if (isBoundedReaderError(error)) {
        return safeJson(400, "Invalid webhook request.");
      }
      throw error;
    }

    const provider = new ResendInboundEmailProvider(config);
    const webhookResult = await handleInboundEmailWebhook(
      { rawBody, headers: request.headers, domain: config.domain },
      createInboundWebhookDependencies(provider)
    );
    return safeJson(webhookResult.status, genericMessage(webhookResult));
  } catch (error) {
    console.error("Inbound email webhook failed.", {
      errorClass: safeErrorClass(error)
    });
    return safeJson(503, "Inbound email is temporarily unavailable.");
  }
}
