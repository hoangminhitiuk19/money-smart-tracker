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

it("exposes owned inbound mailbox and receipt provenance", () => {
  const models = new Map(
    Prisma.dmmf.datamodel.models.map((model) => [model.name, model])
  );
  const draftFields = new Map(
    models.get("TransactionDraft")?.fields.map((field) => [field.name, field])
  );
  const receiptFields = new Map(
    models.get("InboundEmailReceipt")?.fields.map((field) => [field.name, field])
  );

  expect(models.has("InboundMailbox")).toBe(true);
  expect(models.has("InboundEmailReceipt")).toBe(true);
  expect(draftFields.get("inboundEmailReceiptId")).toMatchObject({
    kind: "scalar",
    type: "String",
    isList: false,
    isRequired: false,
    isUnique: true
  });
  expect(draftFields.get("inboundEmailReceipt")).toMatchObject({
    kind: "object",
    type: "InboundEmailReceipt",
    isList: false,
    isRequired: false,
    relationFromFields: ["inboundEmailReceiptId"],
    relationToFields: ["id"],
    relationOnDelete: "SetNull"
  });
  expect(receiptFields.get("draft")).toMatchObject({
    kind: "object",
    type: "TransactionDraft",
    isList: false,
    isRequired: false,
    relationFromFields: [],
    relationToFields: []
  });
});
