import { Prisma } from "@prisma/client";
import Link from "next/link";
import { Suspense } from "react";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import ActivityLogLoading from "./loading";

type SearchParams = Record<string, string | string[] | undefined>;

const pageSize = 50;

const actionOptions = [
  "TRANSACTION_CREATED",
  "TRANSACTION_UPDATED",
  "TRANSACTION_DELETED",
  "GOAL_CONTRIBUTION_CREATED",
  "GOAL_CONTRIBUTION_UPDATED",
  "GOAL_CONTRIBUTION_DELETED",
  "MONEY_SOURCE_CREATED",
  "MONEY_SOURCE_UPDATED",
  "MONEY_SOURCE_DELETED",
  "CATEGORY_CREATED",
  "CATEGORY_UPDATED",
  "CATEGORY_DELETED",
  "PROJECT_CREATED",
  "PROJECT_UPDATED",
  "PROJECT_DELETED",
  "RENEWAL_CREATED",
  "RENEWAL_UPDATED",
  "RENEWAL_MARKED_PAID",
  "RENEWAL_SKIPPED",
  "RENEWAL_PAUSED",
  "RENEWAL_RESUMED",
  "RENEWAL_CANCELLED",
  "RENEWAL_DELETED",
  "CSV_EXPORTED"
];

function getParam(searchParams: SearchParams, key: string) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function actionLabel(action: string) {
  return action
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function metadataObject(metadata: Prisma.JsonValue | null) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  return metadata as Record<string, Prisma.JsonValue>;
}

function metadataText(
  metadata: Record<string, Prisma.JsonValue>,
  key: string,
  fallback = "Unknown"
) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}

function metadataNumber(
  metadata: Record<string, Prisma.JsonValue>,
  key: string,
  fallback = 0
) {
  const value = metadata[key];
  return typeof value === "number" ? value : fallback;
}

function formatMoney(amount: string, currency = "VND") {
  return `${amount} ${currency}`;
}

function formatDateTime(date: Date | string) {
  return new Date(date).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function formatDate(date: string) {
  const value = new Date(date);
  return Number.isNaN(value.getTime())
    ? date
    : value.toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric"
      });
}

function activitySummary(action: string, metadata: Prisma.JsonValue | null) {
  const data = metadataObject(metadata);
  const title = metadataText(data, "title");
  const type = metadataText(data, "type");
  const amount = metadataText(data, "amount", "0");
  const name = metadataText(data, "name");
  const nextDueDate = metadataText(data, "nextDueDate", "");

  switch (action) {
    case "TRANSACTION_CREATED":
      return `Created ${type} transaction: ${title} (${formatMoney(amount)})`;
    case "TRANSACTION_UPDATED":
      return `Updated transaction: ${title}`;
    case "TRANSACTION_DELETED":
      return `Deleted transaction: ${title}`;
    case "GOAL_CONTRIBUTION_CREATED":
      return `Created ${metadataText(data, "type")} goal contribution: ${formatMoney(amount)}`;
    case "GOAL_CONTRIBUTION_UPDATED":
      return `Updated ${metadataText(data, "type")} goal contribution: ${formatMoney(amount)}`;
    case "GOAL_CONTRIBUTION_DELETED":
      return `Deleted ${metadataText(data, "type")} goal contribution: ${formatMoney(amount)}`;
    case "MONEY_SOURCE_CREATED":
      return `Created account or wallet: ${name}`;
    case "MONEY_SOURCE_UPDATED":
      return `Updated account or wallet: ${name}`;
    case "MONEY_SOURCE_DELETED":
      return `Deleted account or wallet: ${name}`;
    case "CATEGORY_CREATED":
      return `Created category: ${name}`;
    case "CATEGORY_UPDATED":
      return `Updated category: ${name}`;
    case "CATEGORY_DELETED":
      return `Deleted category: ${name}`;
    case "PROJECT_CREATED":
      return `Created project: ${name}`;
    case "PROJECT_UPDATED":
      return `Updated project: ${name}`;
    case "PROJECT_DELETED":
      return `Deleted project: ${name}`;
    case "RENEWAL_CREATED":
      return `Created renewal: ${title}`;
    case "RENEWAL_UPDATED":
      return `Updated renewal: ${title}`;
    case "RENEWAL_MARKED_PAID":
      return `Marked ${title} as paid — next due: ${formatDate(nextDueDate)}`;
    case "RENEWAL_SKIPPED":
      return `Skipped ${title} — next due: ${formatDate(nextDueDate)}`;
    case "RENEWAL_PAUSED":
      return `Paused renewal: ${title}`;
    case "RENEWAL_RESUMED":
      return `Resumed renewal: ${title}`;
    case "RENEWAL_CANCELLED":
      return `Cancelled renewal: ${title}`;
    case "RENEWAL_DELETED":
      return `Deleted renewal: ${title}`;
    case "CSV_EXPORTED":
      return `Exported ${metadataNumber(data, "rowCount")} transactions to CSV`;
    default:
      return actionLabel(action);
  }
}

function pageHref(searchParams: SearchParams, page: number) {
  const params = new URLSearchParams();

  Object.entries(searchParams).forEach(([key, value]) => {
    if (!value) {
      return;
    }

    params.set(key, Array.isArray(value) ? value[0] : value);
  });

  params.set("page", String(page));
  return `/activity-log?${params.toString()}`;
}

type PageProps = {
  searchParams: Promise<SearchParams>;
};

export default async function ActivityLogPage({
  searchParams
}: PageProps) {
  const resolvedSearchParams = await searchParams;

  return (
    <Suspense fallback={<ActivityLogLoading />}>
      <ActivityLogPageContent searchParams={resolvedSearchParams} />
    </Suspense>
  );
}

async function ActivityLogPageContent({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  const user = await requireAuth();
  const action = getParam(searchParams, "action");
  const page = parsePositiveInt(getParam(searchParams, "page"), 1);
  const where = {
    userId: user.id,
    action: action || undefined
  };
  const [logs, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.activityLog.count({ where })
  ]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startResult = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endResult = Math.min(total, page * pageSize);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <PageHeader title="Activity Log" />
        <p className="text-sm text-slate-600">
          Review account activity and data changes recorded by server actions.
        </p>
      </div>

      <Card>
        <form className="grid gap-3 md:grid-cols-[1fr_auto]" method="get">
          <label>
            <span className="text-sm font-medium text-slate-700">Action</span>
            <Select className="mt-1" defaultValue={action ?? ""} name="action">
              <option value="">All actions</option>
              {actionOptions.map((option) => (
                <option key={option} value={option}>
                  {actionLabel(option)}
                </option>
              ))}
            </Select>
          </label>
          <div className="md:mt-6">
            <Button className="w-full md:w-auto" type="submit">
              Apply Filter
            </Button>
          </div>
        </form>
      </Card>

      <p className="text-sm text-slate-600">
        Showing {startResult}-{endResult} of {total} log entries
      </p>

      {logs.length === 0 ? (
        <EmptyState
          cta={
            <Link href="/dashboard">
              <Button variant="outline">Go to Dashboard</Button>
            </Link>
          }
          title="No activity recorded yet"
          subtitle="Activity appears here after you create, update, delete, or export app data."
        />
      ) : (
        <Card className="overflow-hidden" padded={false}>
          <div className="overflow-x-auto">
            <table className="min-w-[60rem] divide-y divide-slate-100 text-sm md:min-w-full">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Entity Type</th>
                  <th className="px-4 py-3">Entity ID</th>
                  <th className="px-4 py-3">Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.map((log) => (
                  <tr className="transition hover:bg-slate-50/80" key={log.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {formatDateTime(log.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-950">
                      {actionLabel(log.action)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                      {log.entityType}
                    </td>
                    <td className="max-w-52 truncate px-4 py-3 font-mono text-xs text-slate-500">
                      {log.entityId ?? "-"}
                    </td>
                    <td className="min-w-80 px-4 py-3 text-slate-700">
                      {activitySummary(log.action, log.metadata)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {totalPages > 1 ? (
        <nav className="flex items-center justify-between gap-3 text-sm">
          <Link
            aria-disabled={page <= 1}
            className={`min-h-11 rounded border px-3 py-2 font-medium md:min-h-0 ${
              page <= 1
                ? "pointer-events-none border-slate-200 text-slate-300"
                : "border-slate-300 text-slate-700 hover:bg-white"
            }`}
            href={pageHref(searchParams, Math.max(page - 1, 1))}
          >
            Previous
          </Link>
          <span className="text-slate-600">
            Page {page} of {totalPages}
          </span>
          <Link
            aria-disabled={page >= totalPages}
            className={`min-h-11 rounded border px-3 py-2 font-medium md:min-h-0 ${
              page >= totalPages
                ? "pointer-events-none border-slate-200 text-slate-300"
                : "border-slate-300 text-slate-700 hover:bg-white"
            }`}
            href={pageHref(searchParams, Math.min(page + 1, totalPages))}
          >
            Next
          </Link>
        </nav>
      ) : null}
    </div>
  );
}
