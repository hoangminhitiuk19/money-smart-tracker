export type BoundedReaderError = {
  code: "PAYLOAD_TOO_LARGE" | "BODY_READ_FAILED";
};

const internalErrors = new WeakSet<object>();

function safeError(code: BoundedReaderError["code"]): BoundedReaderError {
  const error: BoundedReaderError = { code };
  internalErrors.add(error);
  return error;
}

export function isBoundedReaderError(
  error: unknown
): error is BoundedReaderError {
  return typeof error === "object" && error !== null && internalErrors.has(error);
}

function declaredLength(headers: Headers): number | null {
  const value = headers.get("content-length")?.trim();

  if (!value || !/^\d+$/.test(value)) {
    return null;
  }

  return Number(value);
}

async function cancelBody(body: ReadableStream<Uint8Array> | null) {
  if (!body) {
    return;
  }

  try {
    await body.cancel();
  } catch {
    // Cancellation is best-effort; callers still receive only the safe code.
  }
}

async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  headers: Headers,
  maximumBytes: number
): Promise<string> {
  const contentLength = declaredLength(headers);

  if (contentLength !== null && contentLength > maximumBytes) {
    await cancelBody(body);
    throw safeError("PAYLOAD_TOO_LARGE");
  }

  if (!body) {
    return "";
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = body.getReader();
  } catch {
    throw safeError("BODY_READ_FAILED");
  }

  const decoder = new TextDecoder();
  const textChunks: string[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        textChunks.push(decoder.decode());
        return textChunks.join("");
      }

      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        try {
          await reader.cancel();
        } catch {
          // Cancellation is best-effort; the limit error remains data-free.
        }
        throw safeError("PAYLOAD_TOO_LARGE");
      }

      textChunks.push(decoder.decode(value, { stream: true }));
    }
  } catch (error) {
    if (isBoundedReaderError(error)) {
      throw error;
    }

    try {
      await reader.cancel();
    } catch {
      // Do not expose cancellation or stream details.
    }
    throw safeError("BODY_READ_FAILED");
  } finally {
    reader.releaseLock();
  }
}

export function readBoundedRequestText(
  request: Request,
  maximumBytes: number
): Promise<string> {
  return readBoundedBody(request.body, request.headers, maximumBytes);
}

export function readBoundedResponseText(
  response: Response,
  maximumBytes: number
): Promise<string> {
  return readBoundedBody(response.body, response.headers, maximumBytes);
}
