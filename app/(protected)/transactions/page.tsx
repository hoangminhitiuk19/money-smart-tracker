import { QualityRating, TransactionType } from "@prisma/client";
import Link from "next/link";
import { Suspense } from "react";
import { TransactionFilters } from "@/components/transaction-filters";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { listCategories } from "@/lib/actions/categories";
import { listMoneySources } from "@/lib/actions/money-sources";
import { listProjects } from "@/lib/actions/projects";
import {
  searchTransactions,
  type TransactionFilters as TransactionFilterValues
} from "@/lib/actions/transactions";
import TransactionsLoading from "./loading";

type SearchParams = Record<string, string | string[] | undefined>;

const typeBadgeVariant: Record<TransactionType, "income" | "expense" | "transfer" | "refund" | "adjustment"> = {
  ADJUSTMENT: "adjustment",
  EXPENSE: "expense",
  INCOME: "income",
  REFUND: "refund",
  TRANSFER: "transfer"
};

const qualityBadgeVariant: Record<QualityRating, "s" | "a" | "b" | "c" | "d"> = {
  A: "a",
  B: "b",
  C: "c",
  D: "d",
  S: "s"
};

function getParam(searchParams: SearchParams, key: string) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function parseEnumValue<T extends string>(
  value: string | undefined,
  allowedValues: readonly T[]
) {
  return value && allowedValues.includes(value as T) ? (value as T) : undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function buildFilters(searchParams: SearchParams): TransactionFilterValues {
  return {
    q: getParam(searchParams, "q"),
    categoryId: getParam(searchParams, "categoryId"),
    endDate: getParam(searchParams, "endDate"),
    moneySourceId: getParam(searchParams, "moneySourceId"),
    page: parsePositiveInt(getParam(searchParams, "page"), 1),
    pageSize: parsePositiveInt(getParam(searchParams, "pageSize"), 20),
    projectId: getParam(searchParams, "projectId"),
    qualityRating: parseEnumValue(
      getParam(searchParams, "qualityRating"),
      Object.values(QualityRating)
    ),
    startDate: getParam(searchParams, "startDate"),
    type: parseEnumValue(getParam(searchParams, "type"), Object.values(TransactionType))
  };
}

function formatMoney(amount: unknown, currency: string) {
  return new Intl.NumberFormat("en-US", {
    currency,
    maximumFractionDigits: 2,
    style: "currency"
  }).format(Number(amount));
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
  return `/transactions?${params.toString()}`;
}

function exportHref(searchParams: SearchParams) {
  const params = new URLSearchParams();
  const startDate = getParam(searchParams, "startDate");
  const endDate = getParam(searchParams, "endDate");

  if (startDate) {
    params.set("startDate", startDate);
  }

  if (endDate) {
    params.set("endDate", endDate);
  }

  const queryString = params.toString();
  return queryString
    ? `/api/export/transactions?${queryString}`
    : "/api/export/transactions";
}

type PageProps = {
  searchParams: Promise<SearchParams>;
};

export default async function TransactionsPage({
  searchParams
}: PageProps) {
  const resolvedSearchParams = await searchParams;

  return (
    <Suspense fallback={<TransactionsLoading />}>
      <TransactionsPageContent searchParams={resolvedSearchParams} />
    </Suspense>
  );
}

async function TransactionsPageContent({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  const filters = buildFilters(searchParams);
  const [
    { transactions, total, page, pageSize },
    categories,
    moneySources,
    projects
  ] = await Promise.all([
    searchTransactions(filters),
    listCategories(),
    listMoneySources(),
    listProjects()
  ]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startResult = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endResult = Math.min(total, page * pageSize);
  const created = getParam(searchParams, "created");

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        action={
          <div className="flex flex-wrap gap-2">
            <Link href={exportHref(searchParams)}>
              <Button variant="outline">Export CSV</Button>
            </Link>
            <Link href="/transactions/new">
              <Button variant="primary">Add Transaction</Button>
            </Link>
          </div>
        }
        title="Transactions"
      />

      {created === "receipt" ? (
        <p className="rounded-md border border-income/20 bg-income/10 px-3 py-2 text-sm text-income">
          Transaction created from receipt entry.
        </p>
      ) : null}

      <TransactionFilters
        categories={categories.map((category) => ({
          id: category.id,
          name: category.name
        }))}
        moneySources={moneySources.map((moneySource) => ({
          id: moneySource.id,
          name: moneySource.name
        }))}
        projects={projects.map((project) => ({
          id: project.id,
          name: project.name
        }))}
      />

      <p className="text-sm text-slate-600">
        Showing {startResult}-{endResult} of {total} transactions
      </p>

      {transactions.length === 0 ? (
        <EmptyState
          cta={
            <Link href="/transactions/new">
              <Button variant="primary">Add Transaction</Button>
            </Link>
          }
          subtitle="Track income, expenses, transfers, refunds, and adjustments in one place."
          title={
            <>
              No transactions yet &mdash; Add your first one
            </>
          }
        />
      ) : (
        <Card className="overflow-hidden" padded={false}>
          <div className="overflow-x-auto">
            <table className="min-w-[72rem] divide-y divide-slate-100 text-sm md:min-w-full">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Quality</th>
                  <th className="px-4 py-3">From Source</th>
                  <th className="px-4 py-3">To Source</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transactions.map((transaction) => (
                  <tr className="transition hover:bg-slate-50/80" key={transaction.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {transaction.transactionDate.toLocaleDateString("en-US")}
                    </td>
                    <td className="min-w-56 px-4 py-3">
                      <p className="font-medium text-slate-950">
                        {transaction.title}
                      </p>
                      {transaction.description ? (
                        <p className="mt-1 line-clamp-1 text-xs text-slate-500">
                          {transaction.description}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        label={transaction.type}
                        variant={typeBadgeVariant[transaction.type]}
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-950">
                      {formatMoney(transaction.amount, transaction.currency)}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {transaction.category?.name ?? "None"}
                    </td>
                    <td className="px-4 py-3">
                      {transaction.qualityRating ? (
                        <Badge
                          label={transaction.qualityRating}
                          variant={qualityBadgeVariant[transaction.qualityRating]}
                        />
                      ) : (
                        <span className="text-slate-400">None</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {transaction.fromMoneySource?.name ??
                        (transaction.adjustedMoneySource
                          ? `Adjusted: ${transaction.adjustedMoneySource.name}`
                          : "None")}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {transaction.toMoneySource?.name ?? "None"}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/transactions/${transaction.id}/edit`}>
                        <Button size="sm" variant="outline">
                          Edit
                        </Button>
                      </Link>
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
            className={`min-h-11 rounded-md border px-3 py-2 font-medium transition md:min-h-0 ${
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
            className={`min-h-11 rounded-md border px-3 py-2 font-medium transition md:min-h-0 ${
              page >= totalPages
                ? "pointer-events-none border-slate-200 text-slate-300"
                : "border-slate-300 text-slate-700 hover:bg-white"
            }`}
            href={pageHref(
              searchParams,
              Math.min(page + 1, totalPages)
            )}
          >
            Next
          </Link>
        </nav>
      ) : null}
    </div>
  );
}
