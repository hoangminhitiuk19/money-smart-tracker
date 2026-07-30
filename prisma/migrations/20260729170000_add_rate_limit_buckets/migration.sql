CREATE TABLE "rate_limit_buckets" (
  "scope" TEXT NOT NULL,
  "identifierHash" TEXT NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rate_limit_buckets_pkey"
    PRIMARY KEY ("scope", "identifierHash", "windowStart")
);

CREATE INDEX "rate_limit_buckets_expiresAt_idx"
  ON "rate_limit_buckets"("expiresAt");
