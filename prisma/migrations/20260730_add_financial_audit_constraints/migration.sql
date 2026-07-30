ALTER TABLE "Category"
  ADD COLUMN "defaultCountTowardFeeWaiver" BOOLEAN NOT NULL DEFAULT true;

UPDATE "Category"
SET "defaultCountTowardFeeWaiver" = false
WHERE "isDefault" = true AND lower("name") = 'annual fee';

UPDATE "Transaction" AS target_transaction
SET "recurringPaymentId" = NULL
WHERE target_transaction."recurringPaymentId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "RecurringPayment" AS renewal
    WHERE renewal."id" = target_transaction."recurringPaymentId"
  );

CREATE INDEX "Transaction_recurringPaymentId_idx"
  ON "Transaction"("recurringPaymentId");
CREATE INDEX "ActivityLog_createdAt_idx"
  ON "ActivityLog"("createdAt");

ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_recurringPaymentId_fkey"
  FOREIGN KEY ("recurringPaymentId")
  REFERENCES "RecurringPayment"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
