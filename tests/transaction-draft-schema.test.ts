import { Prisma } from "@prisma/client";
import { expect, it } from "vitest";

it("exposes the transaction draft and import batch models", () => {
  const names = Prisma.dmmf.datamodel.models.map(({ name }) => name);

  expect(names).toEqual(
    expect.arrayContaining(["TransactionDraft", "TransactionImportBatch"])
  );
});

it("persists safe draft provenance without relying on terminal candidate data", () => {
  const draft = Prisma.dmmf.datamodel.models.find(
    ({ name }) => name === "TransactionDraft"
  );
  const fields = new Map(
    draft?.fields.map(({ name, type }) => [name, type]) ?? []
  );

  expect(fields.get("countTowardFeeWaiverTouched")).toBe("Boolean");
  expect(fields.get("qualityRatingTouched")).toBe("Boolean");
  expect(fields.get("duplicateAcknowledgementRequired")).toBe("Boolean");
  expect(fields.get("invalidMappedFields")).toBe("Json");
});
