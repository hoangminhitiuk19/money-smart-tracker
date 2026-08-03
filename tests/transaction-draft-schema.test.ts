import { Prisma } from "@prisma/client";
import { expect, it } from "vitest";

it("exposes the transaction draft and import batch models", () => {
  const names = Prisma.dmmf.datamodel.models.map(({ name }) => name);

  expect(names).toEqual(
    expect.arrayContaining(["TransactionDraft", "TransactionImportBatch"])
  );
});
