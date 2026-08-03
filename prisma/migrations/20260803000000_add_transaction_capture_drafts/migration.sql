CREATE TYPE "TransactionDraftOrigin" AS ENUM ('QUICK', 'PASTE', 'EMAIL');

CREATE TYPE "TransactionDraftStatus" AS ENUM ('NEEDS_REVIEW', 'READY', 'IMPORTING', 'IMPORTED', 'DISMISSED');

CREATE TYPE "TransactionImportBatchStatus" AS ENUM ('IMPORTING', 'IMPORTED');

CREATE TABLE "TransactionImportBatch" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "origin" "TransactionDraftOrigin" NOT NULL,
  "status" "TransactionImportBatchStatus" NOT NULL DEFAULT 'IMPORTING',
  "draftIds" JSONB NOT NULL DEFAULT '[]',
  "transactionIds" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TransactionImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TransactionDraft" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "captureKey" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "origin" "TransactionDraftOrigin" NOT NULL,
  "status" "TransactionDraftStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
  "confidence" INTEGER,
  "type" "TransactionType",
  "amountText" TEXT,
  "currency" TEXT,
  "title" TEXT,
  "description" TEXT,
  "transactionDateText" TEXT,
  "categoryId" TEXT,
  "qualityRating" "QualityRating",
  "fromMoneySourceId" TEXT,
  "toMoneySourceId" TEXT,
  "adjustedMoneySourceId" TEXT,
  "adjustmentDirection" "AdjustmentDirection",
  "adjustmentTarget" "AdjustmentTarget",
  "projectId" TEXT,
  "relatedTransactionId" TEXT,
  "countTowardFeeWaiver" BOOLEAN,
  "recurringPaymentId" TEXT,
  "isInstallmentRelated" BOOLEAN NOT NULL DEFAULT false,
  "duplicateFingerprint" TEXT,
  "duplicateConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "validationIssues" JSONB NOT NULL DEFAULT '[]',
  "rawRow" JSONB,
  "importBatchId" TEXT,
  "importedTransactionId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TransactionDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TransactionImportBatch_userId_idempotencyKey_key"
  ON "TransactionImportBatch"("userId", "idempotencyKey");
CREATE INDEX "TransactionImportBatch_userId_createdAt_idx"
  ON "TransactionImportBatch"("userId", "createdAt");

CREATE UNIQUE INDEX "TransactionDraft_userId_captureKey_position_key"
  ON "TransactionDraft"("userId", "captureKey", "position");
CREATE INDEX "TransactionDraft_userId_status_idx"
  ON "TransactionDraft"("userId", "status");
CREATE INDEX "TransactionDraft_userId_captureKey_duplicateFingerprint_idx"
  ON "TransactionDraft"("userId", "captureKey", "duplicateFingerprint");
CREATE INDEX "TransactionDraft_importBatchId_idx"
  ON "TransactionDraft"("importBatchId");
CREATE INDEX "TransactionDraft_expiresAt_idx"
  ON "TransactionDraft"("expiresAt");

ALTER TABLE "TransactionImportBatch"
  ADD CONSTRAINT "TransactionImportBatch_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TransactionDraft"
  ADD CONSTRAINT "TransactionDraft_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TransactionDraft"
  ADD CONSTRAINT "TransactionDraft_importBatchId_fkey"
  FOREIGN KEY ("importBatchId") REFERENCES "TransactionImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
