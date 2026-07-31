"use client";

import { ContributionType } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { createContribution } from "@/lib/actions/goal-contributions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";

type TransactionOption = {
  id: string;
  title: string;
  amount: string;
  currency: string;
  transactionDate: string;
};

type MoneySourceOption = {
  id: string;
  name: string;
};

type GoalContributionFormProps = {
  goalId: string;
  moneySources: MoneySourceOption[];
  transactions: TransactionOption[];
  type: ContributionType;
};

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function emptyToUndefined(value: string) {
  return value.trim() ? value : undefined;
}

export function GoalContributionForm({
  goalId,
  moneySources,
  transactions,
  type
}: GoalContributionFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isContribution = type === ContributionType.CONTRIBUTION;

  function handleSubmit(formData: FormData) {
    setError(null);

    startTransition(async () => {
      const result = await createContribution({
        amount: String(formData.get("amount")),
        contributionDate: String(formData.get("contributionDate")),
        fromMoneySourceId: emptyToUndefined(
          String(formData.get("fromMoneySourceId") ?? "")
        ),
        isManualAdjustment: formData.get("isManualAdjustment") === "on",
        note: emptyToUndefined(String(formData.get("note") ?? "")),
        savingGoalId: goalId,
        transactionId: emptyToUndefined(
          String(formData.get("transactionId") ?? "")
        ),
        type
      });

      if (!result.ok) {
        setError(result.error ?? "Unable to save contribution.");
        return;
      }

      formRef.current?.reset();
      router.refresh();
    });
  }

  return (
    <Card title={isContribution ? "Add Contribution" : "Add Withdrawal"}>
      <form
        className="space-y-4"
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit(new FormData(event.currentTarget));
        }}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <label>
            <span className="text-sm font-medium text-slate-700">Amount</span>
            <Input
              className="mt-1"
              min="0.01"
              name="amount"
              required
              step="0.01"
              type="number"
            />
          </label>

          <label>
            <span className="text-sm font-medium text-slate-700">Date</span>
            <Input
              className="mt-1"
              defaultValue={todayInputValue()}
              name="contributionDate"
              required
              type="date"
            />
          </label>

          <label>
            <span className="text-sm font-medium text-slate-700">
              Linked Transaction
            </span>
            <Select className="mt-1" name="transactionId">
              <option value="">No transaction link</option>
              {transactions.map((transaction) => (
                <option key={transaction.id} value={transaction.id}>
                  {transaction.transactionDate} - {transaction.title} (
                  {transaction.amount} {transaction.currency})
                </option>
              ))}
            </Select>
          </label>

          <label>
            <span className="text-sm font-medium text-slate-700">
              Money Source
            </span>
            <Select className="mt-1" name="fromMoneySourceId">
              <option value="">No source link</option>
              {moneySources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </Select>
          </label>

          <label className="md:col-span-2">
            <span className="text-sm font-medium text-slate-700">Note</span>
            <Input className="mt-1" name="note" placeholder="Optional" />
          </label>

          <label className="flex min-h-11 items-center rounded-md border border-slate-200 bg-slate-50 px-3 py-2 md:col-span-2 md:min-h-0">
            <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
              <input name="isManualAdjustment" type="checkbox" />
              Manual adjustment
            </span>
          </label>
        </div>

        {error ? (
          <p className="rounded-md border border-expense/20 bg-expense/10 px-3 py-2 text-sm text-expense">
            {error}
          </p>
        ) : null}

        <Button disabled={isPending} loading={isPending} type="submit">
          {isContribution ? "Add Contribution" : "Add Withdrawal"}
        </Button>
      </form>
    </Card>
  );
}
