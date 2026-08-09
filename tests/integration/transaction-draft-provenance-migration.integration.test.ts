import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";

const migrationPath = new URL(
  "../../prisma/migrations/20260809000000_add_transaction_draft_provenance/migration.sql",
  import.meta.url
);

const schemasToDrop = new Set<string>();

function quotedIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

afterEach(async () => {
  for (const schema of Array.from(schemasToDrop)) {
    await prisma.$executeRawUnsafe(
      `DROP SCHEMA IF EXISTS ${quotedIdentifier(schema)} CASCADE`
    );
    schemasToDrop.delete(schema);
  }
});

describe("transaction draft provenance migration", () => {
  it("backfills editable legacy overrides, clears, and unacknowledged duplicate findings", async () => {
    const schema = `draft_provenance_${randomUUID().replaceAll("-", "")}`;
    const quotedSchema = quotedIdentifier(schema);
    schemasToDrop.add(schema);
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${quotedSchema}`);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE ${quotedSchema}."TransactionDraft"
      (LIKE public."TransactionDraft" INCLUDING ALL)
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE ${quotedSchema}."TransactionDraft"
        DROP COLUMN "countTowardFeeWaiverTouched",
        DROP COLUMN "qualityRatingTouched",
        DROP COLUMN "duplicateAcknowledgementRequired",
        DROP COLUMN "invalidMappedFields"
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO ${quotedSchema}."TransactionDraft" (
        "id", "userId", "captureKey", "position", "origin", "status",
        "type", "countTowardFeeWaiver", "qualityRating",
        "duplicateConfirmed", "validationIssues", "expiresAt", "updatedAt"
      ) VALUES
        (
          'legacy-clear', 'legacy-user', 'legacy-capture', 0, 'PASTE',
          'READY', 'EXPENSE', false, NULL, false,
          '[{"field":"form","message":"Confirm this possible duplicate before importing."}]'::jsonb,
          CURRENT_TIMESTAMP + INTERVAL '30 days', CURRENT_TIMESTAMP
        ),
        (
          'legacy-choice', 'legacy-user', 'legacy-capture', 1, 'PASTE',
          'NEEDS_REVIEW', 'EXPENSE', true, 'C', false, '[]'::jsonb,
          CURRENT_TIMESTAMP + INTERVAL '30 days', CURRENT_TIMESTAMP
        ),
        (
          'legacy-terminal', 'legacy-user', 'legacy-capture', 2, 'PASTE',
          'IMPORTED', 'EXPENSE', false, 'D', false,
          '[{"field":"form","message":"Confirm this possible duplicate before importing."}]'::jsonb,
          CURRENT_TIMESTAMP + INTERVAL '30 days', CURRENT_TIMESTAMP
        )
    `);

    const migration = await readFile(migrationPath, "utf8");
    const statements = migration
      .split(/;\s*(?:\r?\n|$)/)
      .map((statement) => statement.trim())
      .filter(Boolean);
    await prisma.$transaction(async (db) => {
      await db.$executeRawUnsafe(
        `SET LOCAL search_path TO ${quotedSchema}, public`
      );
      for (const statement of statements) {
        await db.$executeRawUnsafe(statement);
      }
    });

    const rows = await prisma.$queryRawUnsafe<
      Array<{
        id: string;
        countTowardFeeWaiverTouched: boolean;
        qualityRatingTouched: boolean;
        duplicateAcknowledgementRequired: boolean;
        invalidMappedFields: unknown;
      }>
    >(`
      SELECT
        "id",
        "countTowardFeeWaiverTouched",
        "qualityRatingTouched",
        "duplicateAcknowledgementRequired",
        "invalidMappedFields"
      FROM ${quotedSchema}."TransactionDraft"
      ORDER BY "position"
    `);

    expect(rows).toEqual([
      {
        id: "legacy-clear",
        countTowardFeeWaiverTouched: true,
        qualityRatingTouched: true,
        duplicateAcknowledgementRequired: true,
        invalidMappedFields: []
      },
      {
        id: "legacy-choice",
        countTowardFeeWaiverTouched: true,
        qualityRatingTouched: true,
        duplicateAcknowledgementRequired: false,
        invalidMappedFields: []
      },
      {
        id: "legacy-terminal",
        countTowardFeeWaiverTouched: false,
        qualityRatingTouched: false,
        duplicateAcknowledgementRequired: false,
        invalidMappedFields: []
      }
    ]);
  }, 20_000);
});
