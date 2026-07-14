import { ContributionType } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { GoalContributionForm } from "@/components/goal-contribution-form";
import {
  deleteContributionFormAction,
  listContributionsForGoal
} from "@/lib/actions/goal-contributions";
import { getGoal } from "@/lib/actions/goals";
import { listMoneySources } from "@/lib/actions/money-sources";
import { requireAuth } from "@/lib/auth";
import { calculateGoalProgress } from "@/lib/calc/goals";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import GoalDetailLoading from "./loading";

function formatMoney(amount: unknown, currency: string) {
  return new Intl.NumberFormat("en-US", {
    currency,
    maximumFractionDigits: 2,
    style: "currency"
  }).format(Number(amount));
}

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

const statusVariants = {
  ACTIVE: "active",
  COMPLETED: "adjustment",
  PAUSED: "paused"
} as const;

export default function GoalDetailPage({
  params
}: {
  params: { id: string };
}) {
  return (
    <Suspense fallback={<GoalDetailLoading />}>
      <GoalDetailPageContent params={params} />
    </Suspense>
  );
}

async function GoalDetailPageContent({
  params
}: {
  params: { id: string };
}) {
  const user = await requireAuth();
  const goal = await getGoal(params.id).catch(() => notFound());
  const [contributions, moneySources, transactions] = await Promise.all([
    listContributionsForGoal(goal.id),
    listMoneySources(),
    prisma.transaction.findMany({
      where: { userId: user.id },
      orderBy: { transactionDate: "desc" },
      select: {
        id: true,
        title: true,
        amount: true,
        currency: true,
        transactionDate: true
      }
    })
  ]);
  const progress = calculateGoalProgress(contributions, goal.targetAmount);
  const transactionOptions = transactions.map((transaction) => ({
    id: transaction.id,
    title: transaction.title,
    amount: transaction.amount.toString(),
    currency: transaction.currency,
    transactionDate: formatDateInput(transaction.transactionDate)
  }));
  const moneySourceOptions = moneySources.map((source) => ({
    id: source.id,
    name: source.name
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link className="text-sm font-medium text-primary hover:text-indigo-700" href="/goals">
        &larr; Back to goals
      </Link>

      <Card>
        <Badge label={goal.status} variant={statusVariants[goal.status]} />
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-950">
              {goal.name}
            </h1>
            {goal.description ? (
              <p className="mt-2 text-sm text-slate-600">
                {goal.description}
              </p>
            ) : null}
            {goal.deadline ? (
              <p className="mt-2 text-sm text-slate-600">
                Deadline {goal.deadline.toLocaleDateString("en-US")}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <a href="#add-contribution">
              <Button variant="primary">Add Contribution</Button>
            </a>
            <a href="#add-withdrawal">
              <Button variant="outline">Add Withdrawal</Button>
            </a>
          </div>
        </div>

        <div className="mt-6">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-slate-700">
              {formatMoney(progress.netContributed, goal.currency)} saved
            </span>
            <span className="text-slate-600">
              {progress.progressPercent.toFixed(1)}%
            </span>
          </div>
          <div className="mt-2">
            <ProgressBar color="#059669" percent={progress.progressPercent} />
          </div>
          <p className="mt-2 text-sm text-slate-600">
            Remaining {formatMoney(progress.remaining, goal.currency)} of{" "}
            {formatMoney(goal.targetAmount, goal.currency)}
          </p>
        </div>
      </Card>

      <Card padded={false} title="Contributions">
        {contributions.length === 0 ? (
          <div className="p-6 text-sm text-slate-600">
            No contributions or withdrawals yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[56rem] divide-y divide-slate-100 text-sm md:min-w-full">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Transaction</th>
                  <th className="px-4 py-3">Note</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {contributions.map((contribution) => {
                  const deleteAction = deleteContributionFormAction.bind(
                    null,
                    contribution.id
                  );

                  return (
                    <tr className="transition hover:bg-slate-50/80" key={contribution.id}>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        {contribution.contributionDate.toLocaleDateString("en-US")}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {contribution.type}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-950">
                        {formatMoney(contribution.amount, goal.currency)}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {contribution.fromMoneySource?.name ?? "None"}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {contribution.transaction?.title ?? "None"}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {contribution.note ?? ""}
                      </td>
                      <td className="px-4 py-3">
                        <form action={deleteAction}>
                          <Button size="sm" type="submit" variant="danger">
                            Delete
                          </Button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="scroll-mt-6" id="add-contribution">
          <GoalContributionForm
            goalId={goal.id}
            moneySources={moneySourceOptions}
            transactions={transactionOptions}
            type={ContributionType.CONTRIBUTION}
          />
        </div>
        <div className="scroll-mt-6" id="add-withdrawal">
          <GoalContributionForm
            goalId={goal.id}
            moneySources={moneySourceOptions}
            transactions={transactionOptions}
            type={ContributionType.WITHDRAWAL}
          />
        </div>
      </div>
    </div>
  );
}
