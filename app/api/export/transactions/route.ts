import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { parseTransactionDateRange } from "@/lib/date-range";
import { prisma } from "@/lib/prisma";
import { checkExport, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import {
  sanitizeTransactionRead,
  transactionReadInclude
} from "@/lib/transaction-read";

const columns = [
  "Date",
  "Type",
  "Title",
  "Amount",
  "Currency",
  "Category",
  "Quality Rating",
  "From Source",
  "To Source",
  "Project",
  "Description",
  "Count Toward Fee Waiver",
  "Created At"
];

function csvCell(value: unknown) {
  const text =
    value === null || value === undefined
      ? ""
      : value instanceof Date
        ? value.toISOString()
        : String(value);

  return `"${text.replace(/"/g, '""')}"`;
}

function csvRow(values: unknown[]) {
  return values.map(csvCell).join(",");
}

export async function GET(request: Request) {
  const user = await requireAuth({ onUnauthenticated: "return-null" });

  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const dateRange = parseTransactionDateRange(
    url.searchParams.get("startDate") ?? undefined,
    url.searchParams.get("endDate") ?? undefined
  );

  if (!dateRange.ok) {
    return new NextResponse(dateRange.error, { status: 400 });
  }

  const rateLimit = await checkExport(user.id);
  if (!rateLimit.allowed) {
    return new NextResponse(RATE_LIMIT_MESSAGE, {
      status: 429,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Retry-After": String(rateLimit.retryAfterSeconds)
      }
    });
  }

  const now = new Date();
  const transactions = await prisma.transaction.findMany({
    where: {
      userId: user.id,
      transactionDate: dateRange.range
    },
    orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
    include: transactionReadInclude
  });
  const safeTransactions = transactions.map((transaction) =>
    sanitizeTransactionRead(transaction, user.id)
  );
  const csv = [
    columns.join(","),
    ...safeTransactions.map((transaction) =>
      csvRow([
        transaction.transactionDate,
        transaction.type,
        transaction.title,
        transaction.amount.toString(),
        transaction.currency,
        transaction.category?.name,
        transaction.qualityRating,
        transaction.fromMoneySource?.name,
        transaction.toMoneySource?.name,
        transaction.project?.name,
        transaction.description,
        transaction.countTowardFeeWaiver,
        transaction.createdAt
      ])
    )
  ].join("\n");

  await prisma.activityLog.create({
    data: {
      userId: user.id,
      action: "CSV_EXPORTED",
      entityType: "Transaction",
      metadata: {
        exportedAt: now.toISOString(),
        rowCount: safeTransactions.length
      }
    }
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Disposition": 'attachment; filename="transactions.csv"',
      "Content-Type": "text/csv"
    }
  });
}
