import { describe, expect, it, vi } from "vitest";

import {
  readBoundedRequestText,
  readBoundedResponseText
} from "@/lib/inbound-email/bounded-reader";
import { MAX_INBOUND_WEBHOOK_BYTES } from "@/lib/inbound-email/constants";

type StreamRequestInit = RequestInit & { duplex: "half" };

function requestWithChunks(
  chunks: readonly Uint8Array[],
  cancel?: (reason?: unknown) => void
) {
  return new Request("http://localhost", {
    method: "POST",
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
      cancel
    }),
    duplex: "half"
  } as StreamRequestInit);
}

describe("bounded inbound-email readers", () => {
  it("rejects a declared request length before trusting its small body", async () => {
    const rejection = readBoundedRequestText(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-length": "256001" },
        body: "small"
      }),
      MAX_INBOUND_WEBHOOK_BYTES
    ).catch((error: unknown) => error);

    await expect(rejection).resolves.toEqual({ code: "PAYLOAD_TOO_LARGE" });
    await expect(rejection).resolves.toSatisfy(
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        Object.keys(error).join(",") === "code"
    );
  });

  it("cancels a chunked request stream immediately after it exceeds the byte limit", async () => {
    const cancel = vi.fn();
    const request = requestWithChunks(
      [
        new Uint8Array(MAX_INBOUND_WEBHOOK_BYTES),
        new Uint8Array([1]),
        new TextEncoder().encode("must-not-be-read")
      ],
      cancel
    );

    await expect(
      readBoundedRequestText(request, MAX_INBOUND_WEBHOOK_BYTES)
    ).rejects.toEqual({ code: "PAYLOAD_TOO_LARGE" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("accepts exact-boundary UTF-8 split in the middle of a multibyte character", async () => {
    const expected = "é".repeat(MAX_INBOUND_WEBHOOK_BYTES / 2);
    const encoded = new TextEncoder().encode(expected);
    const splitInsideCharacter = 127_999;
    const request = requestWithChunks([
      encoded.slice(0, splitInsideCharacter),
      encoded.slice(splitInsideCharacter)
    ]);

    const result = await readBoundedRequestText(
      request,
      MAX_INBOUND_WEBHOOK_BYTES
    );

    expect(result).toBe(expected);
    expect(new TextEncoder().encode(result).byteLength).toBe(
      MAX_INBOUND_WEBHOOK_BYTES
    );
  });

  it("maps an aborted response stream to a data-free typed failure", async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(
            new DOMException("artificial private stream detail", "AbortError")
          );
        }
      })
    );

    const rejection = readBoundedResponseText(response, 100).catch(
      (error: unknown) => error
    );

    await expect(rejection).resolves.toEqual({ code: "BODY_READ_FAILED" });
    await expect(rejection).resolves.toSatisfy(
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        Object.keys(error).join(",") === "code"
    );
  });

  it("does not trust a stream error that mimics an internal error code", async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error({
            code: "PAYLOAD_TOO_LARGE",
            detail: "artificial private stream detail"
          });
        }
      })
    );

    await expect(readBoundedResponseText(response, 100)).rejects.toEqual({
      code: "BODY_READ_FAILED"
    });
  });

  it("returns an ordinary response body unchanged", async () => {
    await expect(
      readBoundedResponseText(new Response("synthetic response"), 100)
    ).resolves.toBe("synthetic response");
  });
});
