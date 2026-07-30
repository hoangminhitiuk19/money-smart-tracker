import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { transactionDateRange } from "@/lib/date-range";
import { prisma } from "@/lib/prisma";
import { checkExport, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";

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

function parseDateParam(value: string | null) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return value;
}

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

  const url = new URL(request.url);
  const startDate = parseDateParam(url.searchParams.get("startDate"));
  const endDate = parseDateParam(url.searchParams.get("endDate"));
  const now = new Date();
  const transactions = await prisma.transaction.findMany({
    where: {
      userId: user.id,
      transactionDate: transactionDateRange(startDate, endDate)
    },
    orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
    include: {
      category: true,
      fromMoneySource: true,
      toMoneySource: true,
      project: true
    }
  });
  const csv = [
    columns.join(","),
    ...transactions.map((transaction) =>
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
        rowCount: transactions.length
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
