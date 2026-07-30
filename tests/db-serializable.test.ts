import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runSerializable } from "@/lib/db/serializable";
import { prisma } from "@/lib/prisma";

const transactionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: transactionMock
  }
}));

function conflict() {
  return new Prisma.PrismaClientKnownRequestError("write conflict", {
    clientVersion: "6.19.0",
    code: "P2034"
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runSerializable", () => {
  it("retries P2034 conflicts and uses Serializable isolation", async () => {
    transactionMock
      .mockRejectedValueOnce(conflict())
      .mockImplementationOnce(async (operation, options) => {
        expect(options).toEqual({
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        });
        return operation({ marker: "transaction-client" });
      });
    const operation = vi.fn(async () => "committed");

    await expect(runSerializable(operation, 2)).resolves.toBe("committed");
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(operation).toHaveBeenCalledWith({
      marker: "transaction-client"
    });
  });

  it("uses three attempts by default and rethrows the final P2034", async () => {
    transactionMock
      .mockRejectedValueOnce(conflict())
      .mockRejectedValueOnce(conflict())
      .mockRejectedValueOnce(conflict());

    await expect(runSerializable(async () => "unused")).rejects.toMatchObject({
      code: "P2034"
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it("does not retry errors other than P2034", async () => {
    const error = new Error("database unavailable");
    transactionMock.mockRejectedValueOnce(error);

    await expect(runSerializable(async () => "unused")).rejects.toBe(error);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
