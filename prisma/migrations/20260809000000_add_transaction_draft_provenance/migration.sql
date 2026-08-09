ALTER TABLE "TransactionDraft"
  ADD COLUMN "countTowardFeeWaiverTouched" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "qualityRatingTouched" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "duplicateAcknowledgementRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "invalidMappedFields" JSONB NOT NULL DEFAULT '[]';

UPDATE "TransactionDraft"
SET
  "countTowardFeeWaiverTouched" = "countTowardFeeWaiver" IS NOT NULL,
  "qualityRatingTouched" = (
    "type" = 'EXPENSE' OR "qualityRating" IS NOT NULL
  ),
  "duplicateAcknowledgementRequired" = (
    NOT "duplicateConfirmed"
    AND "validationIssues" @> '[{"field":"form","message":"Confirm this possible duplicate before importing."}]'::jsonb
  )
WHERE "status" IN ('NEEDS_REVIEW', 'READY');
