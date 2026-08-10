CREATE TYPE "InboundMailboxProvider" AS ENUM ('RESEND');
CREATE TYPE "InboundMailboxStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "InboundEmailReceiptState" AS ENUM (
  'RECEIVED', 'PROCESSING', 'PROCESSED', 'IGNORED',
  'RETRYABLE_FAILED', 'TERMINAL_FAILED'
);
CREATE TYPE "InboundEmailDisposition" AS ENUM (
  'TEST_DRAFT_CREATED', 'DUPLICATE', 'UNSUPPORTED', 'OVERSIZED',
  'RATE_LIMITED', 'PROVIDER_ERROR', 'PARSER_ERROR'
);

CREATE TABLE "InboundMailbox" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" "InboundMailboxProvider" NOT NULL DEFAULT 'RESEND',
  "aliasLocalPart" VARCHAR(64) NOT NULL,
  "status" "InboundMailboxStatus" NOT NULL DEFAULT 'ACTIVE',
  "lastDisposition" "InboundEmailDisposition",
  "lastReceivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InboundMailbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InboundEmailReceipt" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "mailboxId" TEXT NOT NULL,
  "providerEventHash" CHAR(64) NOT NULL,
  "providerMessageHash" CHAR(64) NOT NULL,
  "state" "InboundEmailReceiptState" NOT NULL DEFAULT 'RECEIVED',
  "disposition" "InboundEmailDisposition",
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InboundEmailReceipt_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "TransactionDraft"
  ADD COLUMN "inboundEmailReceiptId" TEXT;

CREATE UNIQUE INDEX "InboundMailbox_userId_key" ON "InboundMailbox"("userId");
CREATE UNIQUE INDEX "InboundMailbox_aliasLocalPart_key" ON "InboundMailbox"("aliasLocalPart");
CREATE UNIQUE INDEX "InboundEmailReceipt_providerEventHash_key" ON "InboundEmailReceipt"("providerEventHash");
CREATE UNIQUE INDEX "InboundEmailReceipt_mailboxId_providerMessageHash_key"
  ON "InboundEmailReceipt"("mailboxId", "providerMessageHash");
CREATE UNIQUE INDEX "TransactionDraft_inboundEmailReceiptId_key"
  ON "TransactionDraft"("inboundEmailReceiptId");
CREATE INDEX "InboundMailbox_status_idx" ON "InboundMailbox"("status");
CREATE INDEX "InboundEmailReceipt_userId_state_idx"
  ON "InboundEmailReceipt"("userId", "state");
CREATE INDEX "InboundEmailReceipt_expiresAt_idx"
  ON "InboundEmailReceipt"("expiresAt");

ALTER TABLE "InboundMailbox" ADD CONSTRAINT "InboundMailbox_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InboundEmailReceipt" ADD CONSTRAINT "InboundEmailReceipt_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InboundEmailReceipt" ADD CONSTRAINT "InboundEmailReceipt_mailboxId_fkey"
  FOREIGN KEY ("mailboxId") REFERENCES "InboundMailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TransactionDraft" ADD CONSTRAINT "TransactionDraft_inboundEmailReceiptId_fkey"
  FOREIGN KEY ("inboundEmailReceiptId") REFERENCES "InboundEmailReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
