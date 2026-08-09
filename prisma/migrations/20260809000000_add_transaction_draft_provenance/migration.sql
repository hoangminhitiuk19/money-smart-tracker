ALTER TABLE "TransactionDraft"
  ADD COLUMN "countTowardFeeWaiverTouched" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "qualityRatingTouched" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "duplicateAcknowledgementRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "invalidMappedFields" JSONB NOT NULL DEFAULT '[]';
