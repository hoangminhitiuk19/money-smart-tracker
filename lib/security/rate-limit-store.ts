import { prisma } from "@/lib/prisma";
import type {
  RateLimitBucketInput,
  RateLimitStore
} from "@/lib/security/rate-limit-core";

export const prismaRateLimitStore: RateLimitStore = {
  async consume(input: RateLimitBucketInput) {
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`
      INSERT INTO "rate_limit_buckets"
        ("scope", "identifierHash", "windowStart", "count", "expiresAt", "createdAt")
      VALUES
        (
          ${input.scope},
          ${input.identifierHash},
          ${input.windowStart},
          1,
          ${input.expiresAt},
          CURRENT_TIMESTAMP
        )
      ON CONFLICT ("scope", "identifierHash", "windowStart")
      DO UPDATE SET
        "count" = "rate_limit_buckets"."count" + 1,
        "expiresAt" = GREATEST(
          "rate_limit_buckets"."expiresAt",
          EXCLUDED."expiresAt"
        )
      RETURNING "count"
    `;

    return rows[0].count;
  },

  async cleanupExpired(now: Date, maximumRows: number) {
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`
      WITH "expired" AS (
        SELECT "scope", "identifierHash", "windowStart"
        FROM "rate_limit_buckets"
        WHERE "expiresAt" <= ${now}
        ORDER BY "expiresAt"
        LIMIT ${maximumRows}
      ),
      "deleted" AS (
        DELETE FROM "rate_limit_buckets" AS "bucket"
        USING "expired"
        WHERE "bucket"."scope" = "expired"."scope"
          AND "bucket"."identifierHash" = "expired"."identifierHash"
          AND "bucket"."windowStart" = "expired"."windowStart"
        RETURNING 1
      )
      SELECT COUNT(*)::INTEGER AS "count"
      FROM "deleted"
    `;

    return rows[0].count;
  }
};
