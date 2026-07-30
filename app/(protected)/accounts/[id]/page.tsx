import { MoneySourceType, TransactionType } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getMoneySource } from "@/lib/actions/money-sources";
import { requireAuth } from "@/lib/auth";
import { calculateTrackedBalance } from "@/lib/calc/balance";
import {
  calculateCreditCardState,
  calculateFeeWaiverState
} from "@/lib/calc/credit-card";
import {
  decimal,
  presentationNumber,
  type DecimalInput
} from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import AccountDetailLoading from "./loading";

const typeLabels: Record<MoneySourceType, string> = {
  CASH: "Cash",
  BANK_ACCOUNT: "Bank Account",
  CREDIT_CARD: "Credit Card",
  DEBIT_CARD: "Debit Card",
  E_WALLET: "E-Wallet",
  INVESTMENT: "Investment",
  OTHER: "Other"
};

function formatMoney(amount: DecimalInput, currency: string) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    style: "currency",
    currency
  }).format(presentationNumber(amount));
}

function formatPercent(amount: DecimalInput) {
  return `${decimal(amount).toDecimalPlaces(0).toFixed(0)}%`;
}

function formatDate(date: Date) {
  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function formatPeriod(period: string | null) {
  if (!period) {
    return "period";
  }

  return period
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function getMonthRange(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);

  return { start, end };
}

function daysUntil(date: Date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const target = new Date(date);
  target.setHours(0, 0, 0, 0);

  return Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
}

function MoneyMetric({
  label,
  value,
  note = "Tracked estimate from your records"
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="border-b border-slate-100 py-3 last:border-b-0">
      <dt className="text-sm font-medium text-slate-600">{label}</dt>
      <dd className="mt-1 text-lg font-semibold text-slate-950">{value}</dd>
      <dd className="mt-1 text-xs text-slate-500">{note}</dd>
    </div>
  );
}

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function AccountDetailPage({
  params
}: PageProps) {
  const { id } = await params;

  return (
    <Suspense fallback={<AccountDetailLoading />}>
      <AccountDetailPageContent id={id} />
    </Suspense>
  );
}

async function AccountDetailPageContent({
  id
}: {
  id: string;
}) {
  const user = await requireAuth();
  const source = await getMoneySource(id).catch(() => notFound());

  const transactionScope = {
    userId: user.id,
    OR: [
      { fromMoneySourceId: source.id },
      { toMoneySourceId: source.id },
      { adjustedMoneySourceId: source.id }
    ]
  };

  const sourceTransactions = await prisma.transaction.findMany({
    where: transactionScope,
    orderBy: { transactionDate: "asc" },
    select: {
      id: true,
      title: true,
      type: true,
      amount: true,
      currency: true,
      transactionDate: true,
      fromMoneySourceId: true,
      toMoneySourceId: true,
      adjustedMoneySourceId: true,
      adjustmentDirection: true,
      adjustmentTarget: true,
      relatedTransactionId: true,
      countTowardFeeWaiver: true
    }
  });

  const trackedBalance = calculateTrackedBalance(source, sourceTransactions);
  const recentTransactions = [...sourceTransactions]
    .sort((a, b) => b.transactionDate.getTime() - a.transactionDate.getTime())
    .slice(0, 10);
  const { start: monthStart, end: nextMonthStart } = getMonthRange(new Date());
  const isCreditCard = source.type === MoneySourceType.CREDIT_CARD;
  const creditCardState = isCreditCard
    ? calculateCreditCardState(source, sourceTransactions)
    : null;
  const feeWaiverState = isCreditCard
    ? calculateFeeWaiverState(source, sourceTransactions)
    : null;
  const paymentsThisMonth = sourceTransactions.reduce((total, transaction) => {
    const isPayment =
      transaction.type === TransactionType.TRANSFER &&
      transaction.toMoneySourceId === source.id &&
      transaction.transactionDate >= monthStart &&
      transaction.transactionDate < nextMonthStart;

    return isPayment ? total.plus(decimal(transaction.amount)) : total;
  }, decimal(0));
  const expensesThisMonth = sourceTransactions.reduce((total, transaction) => {
    const isExpense =
      transaction.type === TransactionType.EXPENSE &&
      transaction.fromMoneySourceId === source.id &&
      transaction.transactionDate >= monthStart &&
      transaction.transactionDate < nextMonthStart;

    return isExpense ? total.plus(decimal(transaction.amount)) : total;
  }, decimal(0));

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <Link className="text-sm font-medium text-primary hover:text-indigo-700" href="/accounts">
          &larr; Back to accounts
        </Link>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-950">
              {source.name}
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              {typeLabels[source.type]}{" "}
              {source.providerName ? `at ${source.providerName}` : ""}
            </p>
          </div>
          <Badge
            label={source.isActive ? "Active" : "Inactive"}
            variant={source.isActive ? "active" : "paused"}
          />
        </div>
      </div>

      <div className="rounded-xl bg-slate-900 p-6 shadow-sm">
        <p className="text-sm font-medium text-slate-400">
          Tracked in this app
        </p>
        <p className="mt-3 text-3xl font-bold tracking-tight text-white">
          {formatMoney(trackedBalance, source.currency)}
        </p>
        <p className="mt-3 text-xs text-slate-500">
          This is based on opening balance plus app transactions. It may differ
          from your official provider statement.
        </p>
      </div>

      {creditCardState ? (
        <Card title="Credit Card">
          <dl className="grid gap-x-6 md:grid-cols-2">
            <MoneyMetric
              label="Credit limit"
              value={formatMoney(source.creditLimit ?? 0, source.currency)}
            />
            <MoneyMetric
              label="Tracked debt"
              note="Tracked estimate from your records"
              value={formatMoney(
                creditCardState.outstandingDebt,
                source.currency
              )}
            />
            <MoneyMetric
              label="Available credit"
              value={formatMoney(creditCardState.availableCredit, source.currency)}
            />
            {creditCardState.cardCredit.gt(0) ? (
              <MoneyMetric
                label="Card credit"
                value={formatMoney(
                  creditCardState.cardCredit,
                  source.currency
                )}
              />
            ) : null}
            <MoneyMetric
              label="Payments this month"
              value={formatMoney(paymentsThisMonth, source.currency)}
            />
            <MoneyMetric
              label="Expenses this month"
              value={formatMoney(expensesThisMonth, source.currency)}
            />
          </dl>

          {source.hasAnnualFee ? (
            <div className="mt-6 border-t border-slate-100 pt-5">
              <h3 className="text-sm font-semibold text-slate-950">
                Annual Fee
              </h3>
              <dl className="mt-3 grid gap-x-6 md:grid-cols-2">
                <MoneyMetric
                  label="Annual fee"
                  value={formatMoney(
                    source.annualFeeAmount ?? 0,
                    source.annualFeeCurrency
                  )}
                />
                {source.annualFeeChargeDate ? (
                  <div className="border-b border-slate-100 py-3 last:border-b-0">
                    <dt className="text-sm font-medium text-slate-600">
                      Next charge
                    </dt>
                    <dd className="mt-1 text-lg font-semibold text-slate-950">
                      {formatDate(source.annualFeeChargeDate)} &mdash;{" "}
                      {daysUntil(source.annualFeeChargeDate)} days away
                    </dd>
                  </div>
                ) : null}
                {source.feeWaivedUntilDate ? (
                  <div className="border-b border-slate-100 py-3 last:border-b-0">
                    <dt className="text-sm font-medium text-slate-600">
                      Waived until
                    </dt>
                    <dd className="mt-1 text-lg font-semibold text-slate-950">
                      {formatDate(source.feeWaivedUntilDate)}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </div>
          ) : null}

          {source.annualFeeWaiverEnabled && feeWaiverState ? (
            <div className="mt-6 border-t border-slate-100 pt-5">
              <h3 className="text-sm font-semibold text-slate-950">
                Fee Waiver
              </h3>
              <dl className="mt-3 grid gap-x-6 md:grid-cols-2">
                <MoneyMetric
                  label="Target"
                  value={`${formatMoney(
                    source.annualFeeWaiverSpendTarget ?? 0,
                    source.currency
                  )}/${formatPeriod(source.annualFeeWaiverPeriod)}`}
                />
                <MoneyMetric
                  label="Tracked eligible"
                  value={formatMoney(
                    feeWaiverState.eligibleSpending,
                    source.currency
                  )}
                />
                <MoneyMetric
                  label="Remaining"
                  value={formatMoney(feeWaiverState.remaining, source.currency)}
                />
              </dl>
              <div className="mt-4">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium text-slate-700">
                    Tracked in this app &mdash; verify with your bank
                  </span>
                  <span className="font-semibold text-slate-950">
                    {formatPercent(feeWaiverState.progress)}
                  </span>
                </div>
                <div className="mt-2">
                  <ProgressBar color="#4f46e5" percent={feeWaiverState.progress} />
                </div>
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card padded={false} title="Recent Transactions">
        {recentTransactions.length === 0 ? (
          <div className="p-6 text-sm text-slate-600">
            No transactions reference this source yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[40rem] divide-y divide-slate-100 text-sm md:min-w-full">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentTransactions.map((transaction) => (
                  <tr className="transition hover:bg-slate-50/80" key={transaction.id}>
                    <td className="px-4 py-3 text-slate-600">
                      {transaction.transactionDate.toLocaleDateString("en-US")}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-950">
                      {transaction.title}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {transaction.type}
                    </td>
                    <td className="px-4 py-3 text-slate-950">
                      {formatMoney(transaction.amount, transaction.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
