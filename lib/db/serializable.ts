import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const DEFAULT_MAX_ATTEMPTS = 3;

function isWriteConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

export async function runSerializable<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  timeoutMs?: number
): Promise<T> {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("maxAttempts must be a positive integer.");
  }
  if (
    timeoutMs !== undefined &&
    (!Number.isInteger(timeoutMs) || timeoutMs < 1)
  ) {
    throw new RangeError("timeoutMs must be a positive integer.");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        ...(timeoutMs === undefined ? {} : { timeout: timeoutMs })
      });
    } catch (error) {
      if (!isWriteConflict(error) || attempt === maxAttempts) {
        throw error;
      }
    }
  }

  throw new Error("Serializable transaction attempts exhausted.");
}
