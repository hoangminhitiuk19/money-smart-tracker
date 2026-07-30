import { GoalStatus } from "@prisma/client";
import Link from "next/link";
import { Suspense } from "react";
import {
  createGoalFormAction,
  deleteGoalFormAction,
  listGoals,
  updateGoalFormAction
} from "@/lib/actions/goals";
import { calculateGoalProgress } from "@/lib/calc/goals";
import {
  decimal,
  presentationNumber,
  type DecimalInput
} from "@/lib/money";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Select } from "@/components/ui/Select";
import GoalsLoading from "./loading";

const goalStatuses = Object.values(GoalStatus);

const statusVariants = {
  ACTIVE: "active",
  COMPLETED: "adjustment",
  PAUSED: "paused"
} as const;

function formatMoney(amount: DecimalInput, currency: string) {
  return new Intl.NumberFormat("en-US", {
    currency,
    maximumFractionDigits: 2,
    style: "currency"
  }).format(presentationNumber(amount));
}

function formatDateInput(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : "";
}

export default function GoalsPage() {
  return (
    <Suspense fallback={<GoalsLoading />}>
      <GoalsPageContent />
    </Suspense>
  );
}

async function GoalsPageContent() {
  const goals = await listGoals();

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div>
        <PageHeader
          action={
            <a href="#add-goal">
              <Button variant="primary">Add Goal</Button>
            </a>
          }
          title="Saving Goals"
        />
        <p className="mt-2 text-sm text-slate-600">
          Track target savings, contributions, withdrawals, and remaining
          amounts.
        </p>
      </div>

      <Card title="Add Goal">
        <div className="scroll-mt-6" id="add-goal" />
        <form
          action={createGoalFormAction}
          className="mt-4 grid gap-3 md:grid-cols-6"
        >
          <label className="md:col-span-2">
            <span className="text-sm font-medium text-slate-700">Name</span>
            <Input className="mt-1" name="name" required />
          </label>
          <label>
            <span className="text-sm font-medium text-slate-700">Target</span>
            <Input
              className="mt-1"
              min="0.01"
              name="targetAmount"
              required
              step="0.01"
              type="number"
            />
          </label>
          <label>
            <span className="text-sm font-medium text-slate-700">
              Currency
            </span>
            <Input
              className="mt-1 uppercase"
              defaultValue="VND"
              name="currency"
              required
            />
          </label>
          <label>
            <span className="text-sm font-medium text-slate-700">Deadline</span>
            <Input className="mt-1" name="deadline" type="date" />
          </label>
          <label>
            <span className="text-sm font-medium text-slate-700">Status</span>
            <Select className="mt-1" defaultValue={GoalStatus.ACTIVE} name="status">
              {goalStatuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </Select>
          </label>
          <label className="md:col-span-5">
            <span className="text-sm font-medium text-slate-700">
              Description
            </span>
            <Input
              className="mt-1"
              name="description"
              placeholder="Optional"
            />
          </label>
          <div className="md:flex md:items-end md:justify-end">
            <Button className="w-full md:w-auto" type="submit">
              Add Goal
            </Button>
          </div>
        </form>
      </Card>

      {goals.length === 0 ? (
        <EmptyState
          cta={
            <a href="#add-goal">
              <Button variant="primary">Create Goal</Button>
            </a>
          }
          title={
            <>
              No saving goals yet &mdash; Create your first goal
            </>
          }
          subtitle="Set a target and track contributions toward it."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {goals.map((goal) => {
            const progress = calculateGoalProgress(
              goal.goalContributions,
              goal.targetAmount
            );
            const updateAction = updateGoalFormAction.bind(null, goal.id);
            const deleteAction = deleteGoalFormAction.bind(null, goal.id);

            return (
              <Card hover key={goal.id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Link
                      className="text-lg font-semibold text-slate-950 hover:text-primary"
                      href={`/goals/${goal.id}`}
                    >
                      {goal.name}
                    </Link>
                    {goal.deadline ? (
                      <p className="mt-1 text-sm text-slate-600">
                        Deadline {goal.deadline.toLocaleDateString("en-US")}
                      </p>
                    ) : null}
                  </div>
                  <Badge
                    label={goal.status}
                    variant={statusVariants[goal.status]}
                  />
                </div>

                <div className="mt-4">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium text-slate-700">
                      {formatMoney(progress.netContributed, goal.currency)}
                    </span>
                    <span className="text-slate-600">
                      {decimal(progress.progressPercent).toFixed(1)}%
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

                <form
                  action={updateAction}
                  className="mt-5 grid gap-3"
                  id={`goal-${goal.id}`}
                >
                  <Input
                    className="font-medium"
                    defaultValue={goal.name}
                    name="name"
                    required
                  />
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Input
                      defaultValue={goal.targetAmount.toString()}
                      min="0.01"
                      name="targetAmount"
                      required
                      step="0.01"
                      type="number"
                    />
                    <Input
                      className="uppercase"
                      defaultValue={goal.currency}
                      name="currency"
                      required
                    />
                    <Select defaultValue={goal.status} name="status">
                      {goalStatuses.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Input
                    defaultValue={formatDateInput(goal.deadline)}
                    name="deadline"
                    type="date"
                  />
                  <Input
                    defaultValue={goal.description ?? ""}
                    name="description"
                    placeholder="Description"
                  />
                </form>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    form={`goal-${goal.id}`}
                    size="sm"
                    type="submit"
                    variant="secondary"
                  >
                    Save
                  </Button>
                  <form action={deleteAction}>
                    <Button size="sm" type="submit" variant="danger">
                      Delete
                    </Button>
                  </form>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
