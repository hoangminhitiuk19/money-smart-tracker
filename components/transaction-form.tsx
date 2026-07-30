"use client";

import {
  AdjustmentDirection,
  AdjustmentTarget,
  MoneySourceType,
  QualityRating,
  TransactionType
} from "@prisma/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  createTransaction,
  deleteTransaction,
  updateTransaction,
  type TransactionFormInput
} from "@/lib/actions/transactions";

type CategoryOption = {
  id: string;
  name: string;
  defaultCountTowardFeeWaiver: boolean;
  defaultQualityRating: QualityRating | null;
};

type MoneySourceOption = {
  id: string;
  name: string;
  type: MoneySourceType;
};

type ProjectOption = {
  id: string;
  name: string;
};

type ExpenseOption = {
  id: string;
  title: string;
  amount: string;
  transactionDate: string;
};

export type TransactionFormInitialValues = {
  id: string;
  type: TransactionType;
  amount: string;
  currency: string;
  title: string;
  description: string;
  transactionDate: string;
  categoryId: string;
  qualityRating: QualityRating | "";
  fromMoneySourceId: string;
  toMoneySourceId: string;
  adjustedMoneySourceId: string;
  adjustmentDirection: AdjustmentDirection | "";
  adjustmentTarget: AdjustmentTarget | "";
  projectId: string;
  relatedTransactionId: string;
  countTowardFeeWaiver: boolean;
};

type TransactionFormProps = {
  categories: CategoryOption[];
  expenseTransactions: ExpenseOption[];
  initialValues?: TransactionFormInitialValues;
  moneySources: MoneySourceOption[];
  projects: ProjectOption[];
};

const transactionTypes = Object.values(TransactionType);
const qualityRatings = Object.values(QualityRating);

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function emptyToUndefined(value: string) {
  return value.trim() ? value : undefined;
}

function emptyToNull(value: string) {
  return value.trim() ? value : null;
}

function isCreditCard(sourceId: string, moneySources: MoneySourceOption[]) {
  return (
    moneySources.find((moneySource) => moneySource.id === sourceId)?.type ===
    MoneySourceType.CREDIT_CARD
  );
}

function SegmentedToggle({
  checked,
  label,
  onChange
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <label className="flex-1">
      <input
        checked={checked}
        className="peer sr-only"
        onChange={onChange}
        type="radio"
      />
      <span className="block min-h-11 rounded-md px-3 py-2 text-center text-sm font-medium text-slate-600 transition peer-checked:bg-primary peer-checked:text-white md:min-h-0">
        {label}
      </span>
    </label>
  );
}

export function TransactionForm({
  categories,
  expenseTransactions,
  initialValues,
  moneySources,
  projects
}: TransactionFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<TransactionType>(
    initialValues?.type ?? TransactionType.EXPENSE
  );
  const [categoryId, setCategoryId] = useState(initialValues?.categoryId ?? "");
  const [qualityRating, setQualityRating] = useState<QualityRating | "">(
    initialValues?.qualityRating ?? ""
  );
  const [qualityTouched, setQualityTouched] = useState(Boolean(initialValues));
  const [fromMoneySourceId, setFromMoneySourceId] = useState(
    initialValues?.fromMoneySourceId ?? ""
  );
  const [toMoneySourceId, setToMoneySourceId] = useState(
    initialValues?.toMoneySourceId ?? ""
  );
  const [adjustedMoneySourceId, setAdjustedMoneySourceId] = useState(
    initialValues?.adjustedMoneySourceId ?? ""
  );
  const [adjustmentDirection, setAdjustmentDirection] = useState<
    AdjustmentDirection | ""
  >(initialValues?.adjustmentDirection ?? AdjustmentDirection.INCREASE);
  const [adjustmentTarget, setAdjustmentTarget] = useState<
    AdjustmentTarget | ""
  >(initialValues?.adjustmentTarget ?? AdjustmentTarget.CREDIT_CARD_DEBT);
  const [countTowardFeeWaiver, setCountTowardFeeWaiver] = useState(
    initialValues?.countTowardFeeWaiver ?? false
  );
  const [feeWaiverTouched, setFeeWaiverTouched] = useState(
    Boolean(initialValues)
  );
  const [expenseSearch, setExpenseSearch] = useState("");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const selectedCategory = useMemo(
    () => categories.find((category) => category.id === categoryId),
    [categories, categoryId]
  );
  const fromIsCreditCard = isCreditCard(fromMoneySourceId, moneySources);
  const toIsCreditCard = isCreditCard(toMoneySourceId, moneySources);
  const adjustedIsCreditCard = isCreditCard(adjustedMoneySourceId, moneySources);
  const isEdit = Boolean(initialValues?.id);
  const filteredExpenseTransactions = useMemo(() => {
    const search = expenseSearch.trim().toLowerCase();

    if (!search) {
      return expenseTransactions;
    }

    return expenseTransactions.filter((transaction) =>
      transaction.title.toLowerCase().includes(search)
    );
  }, [expenseSearch, expenseTransactions]);

  useEffect(() => {
    if (
      type === TransactionType.EXPENSE &&
      selectedCategory?.defaultQualityRating &&
      !qualityTouched
    ) {
      setQualityRating(selectedCategory.defaultQualityRating);
    }
  }, [qualityTouched, selectedCategory, type]);

  useEffect(() => {
    if (type === TransactionType.EXPENSE && fromIsCreditCard) {
      if (!feeWaiverTouched) {
        setCountTowardFeeWaiver(
          selectedCategory?.defaultCountTowardFeeWaiver !== false
        );
      }
    } else {
      setCountTowardFeeWaiver(false);
    }
  }, [feeWaiverTouched, fromIsCreditCard, selectedCategory, type]);

  function buildPayload(formData: FormData): TransactionFormInput {
    const basePayload = {
      amount: String(formData.get("amount") ?? ""),
      categoryId: emptyToNull(categoryId),
      countTowardFeeWaiver:
        type === TransactionType.EXPENSE && fromIsCreditCard
          ? countTowardFeeWaiver
          : false,
      currency: String(formData.get("currency") || "VND"),
      description: emptyToNull(String(formData.get("description") ?? "")),
      isInstallmentRelated: false,
      projectId: emptyToNull(String(formData.get("projectId") ?? "")),
      title: String(formData.get("title") ?? ""),
      transactionDate: String(formData.get("transactionDate")),
      type
    };

    if (type === TransactionType.INCOME) {
      return {
        ...basePayload,
        toMoneySourceId: emptyToUndefined(toMoneySourceId)
      };
    }

    if (type === TransactionType.EXPENSE) {
      return {
        ...basePayload,
        fromMoneySourceId: emptyToUndefined(fromMoneySourceId),
        qualityRating: qualityRating || null
      };
    }

    if (type === TransactionType.TRANSFER) {
      return {
        ...basePayload,
        fromMoneySourceId: emptyToUndefined(fromMoneySourceId),
        toMoneySourceId: emptyToUndefined(toMoneySourceId)
      };
    }

    if (type === TransactionType.REFUND) {
      return {
        ...basePayload,
        relatedTransactionId: emptyToNull(
          String(formData.get("relatedTransactionId") ?? "")
        ),
        toMoneySourceId: emptyToUndefined(toMoneySourceId)
      };
    }

    return {
      ...basePayload,
      adjustedMoneySourceId: emptyToUndefined(adjustedMoneySourceId),
      adjustmentDirection: adjustmentDirection || undefined,
      adjustmentTarget: adjustedIsCreditCard
        ? adjustmentTarget || null
        : null
    };
  }

  function handleSubmit(formData: FormData) {
    setError(null);
    const payload = buildPayload(formData);

    startTransition(async () => {
      const result =
        isEdit && initialValues
          ? await updateTransaction(initialValues.id, payload)
          : await createTransaction(payload);

      if (!result.ok) {
        setError(result.error ?? "Unable to save transaction.");
        return;
      }

      router.push("/transactions");
      router.refresh();
    });
  }

  function handleDelete() {
    if (!initialValues?.id) {
      return;
    }

    startTransition(async () => {
      const result = await deleteTransaction(initialValues.id);

      if (!result.ok) {
        setError(result.error ?? "Unable to delete transaction.");
        return;
      }

      router.push("/transactions");
      router.refresh();
    });
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit(new FormData(event.currentTarget));
      }}
    >
      <Card>
        <div className="grid gap-4 md:grid-cols-3">
          <label>
            <span className="text-sm font-medium text-slate-700">Type</span>
            <Select
              className="mt-1"
              onChange={(event) => {
                setType(event.target.value as TransactionType);
                setQualityTouched(false);
                setFeeWaiverTouched(false);
              }}
              value={type}
            >
              {transactionTypes.map((transactionType) => (
                <option key={transactionType} value={transactionType}>
                  {transactionType}
                </option>
              ))}
            </Select>
          </label>

          <label>
            <span className="text-sm font-medium text-slate-700">Amount</span>
            <Input
              className="mt-1"
              defaultValue={initialValues?.amount ?? ""}
              min="0.01"
              name="amount"
              required
              step="0.01"
              type="number"
            />
          </label>

          <label>
            <span className="text-sm font-medium text-slate-700">Currency</span>
            <Input
              className="mt-1 uppercase"
              defaultValue={initialValues?.currency ?? "VND"}
              name="currency"
              required
            />
          </label>

          <label className="md:col-span-2">
            <span className="text-sm font-medium text-slate-700">Title</span>
            <Input
              className="mt-1"
              defaultValue={initialValues?.title ?? ""}
              name="title"
              required
            />
          </label>

          <label>
            <span className="text-sm font-medium text-slate-700">Date</span>
            <Input
              className="mt-1"
              defaultValue={initialValues?.transactionDate ?? todayInputValue()}
              name="transactionDate"
              required
              type="date"
            />
          </label>

          <label className="md:col-span-3">
            <span className="text-sm font-medium text-slate-700">
              Description
            </span>
            <textarea
              className="mt-1 min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              defaultValue={initialValues?.description ?? ""}
              name="description"
            />
          </label>
        </div>
      </Card>

      <Card>
        <div className="grid gap-4 md:grid-cols-2">
          {(type === TransactionType.EXPENSE ||
            type === TransactionType.TRANSFER) && (
            <label>
              <span className="text-sm font-medium text-slate-700">
                From Source
              </span>
              <Select
                className="mt-1"
                onChange={(event) => {
                  setFromMoneySourceId(event.target.value);
                  setFeeWaiverTouched(false);
                }}
                required
                value={fromMoneySourceId}
              >
                <option value="">Select source</option>
                {moneySources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
              </Select>
            </label>
          )}

          {(type === TransactionType.INCOME ||
            type === TransactionType.TRANSFER ||
            type === TransactionType.REFUND) && (
            <label>
              <span className="text-sm font-medium text-slate-700">
                To Source
              </span>
              <Select
                className="mt-1"
                onChange={(event) => setToMoneySourceId(event.target.value)}
                required
                value={toMoneySourceId}
              >
                <option value="">Select source</option>
                {moneySources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
              </Select>
            </label>
          )}

          {type === TransactionType.TRANSFER && toIsCreditCard ? (
            <p className="rounded-md border border-transfer/20 bg-transfer/10 px-3 py-2 text-sm text-transfer md:col-span-2">
              This will reduce your tracked card debt
            </p>
          ) : null}

          {type === TransactionType.ADJUSTMENT ? (
            <>
              <label>
                <span className="text-sm font-medium text-slate-700">
                  Adjusted Source
                </span>
                <Select
                  className="mt-1"
                  onChange={(event) =>
                    setAdjustedMoneySourceId(event.target.value)
                  }
                  required
                  value={adjustedMoneySourceId}
                >
                  <option value="">Select source</option>
                  {moneySources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.name}
                    </option>
                  ))}
                </Select>
              </label>

              <fieldset>
                <legend className="text-sm font-medium text-slate-700">
                  Adjustment Direction
                </legend>
                <div className="mt-2 flex rounded-md border border-slate-300 p-1">
                  {Object.values(AdjustmentDirection).map((direction) => (
                    <SegmentedToggle
                      checked={adjustmentDirection === direction}
                      key={direction}
                      label={
                        direction === AdjustmentDirection.INCREASE
                          ? "Increase"
                          : "Decrease"
                      }
                      onChange={() => setAdjustmentDirection(direction)}
                    />
                  ))}
                </div>
              </fieldset>

              {adjustedIsCreditCard ? (
                <fieldset className="md:col-span-2">
                  <legend className="text-sm font-medium text-slate-700">
                    Adjustment Target
                  </legend>
                  <div className="mt-2 flex rounded-md border border-slate-300 p-1">
                    <SegmentedToggle
                      checked={
                        adjustmentTarget === AdjustmentTarget.CREDIT_CARD_DEBT
                      }
                      label="Debt"
                      onChange={() =>
                        setAdjustmentTarget(AdjustmentTarget.CREDIT_CARD_DEBT)
                      }
                    />
                    <SegmentedToggle
                      checked={adjustmentTarget === AdjustmentTarget.CARD_CREDIT}
                      label="Card Credit"
                      onChange={() =>
                        setAdjustmentTarget(AdjustmentTarget.CARD_CREDIT)
                      }
                    />
                  </div>
                </fieldset>
              ) : null}

              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 md:col-span-2">
                This corrects your tracked balance. It does not count as income
                or expense.
              </p>
            </>
          ) : null}
        </div>
      </Card>

      <Card>
        <div className="grid gap-4 md:grid-cols-2">
          <label>
            <span className="text-sm font-medium text-slate-700">Category</span>
            <Select
              className="mt-1"
              onChange={(event) => {
                setCategoryId(event.target.value);
                setQualityTouched(false);
                setFeeWaiverTouched(false);
              }}
              value={categoryId}
            >
              <option value="">No category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </label>

          <label>
            <span className="text-sm font-medium text-slate-700">Project</span>
            <Select
              className="mt-1"
              defaultValue={initialValues?.projectId ?? ""}
              name="projectId"
            >
              <option value="">No project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </label>

          {type === TransactionType.EXPENSE ? (
            <label>
              <span className="text-sm font-medium text-slate-700">
                Quality Rating
              </span>
              <Select
                className="mt-1"
                onChange={(event) => {
                  setQualityTouched(true);
                  setQualityRating(event.target.value as QualityRating | "");
                }}
                value={qualityRating}
              >
                <option value="">No rating</option>
                {qualityRatings.map((rating) => (
                  <option key={rating} value={rating}>
                    {rating}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}

          {type === TransactionType.EXPENSE && fromIsCreditCard ? (
            <label className="rounded-md border border-income/20 bg-income/10 px-3 py-2 md:col-span-2">
              <span className="flex items-center gap-2 text-sm font-medium text-income">
                <input
                  checked={countTowardFeeWaiver}
                  onChange={(event) => {
                    setFeeWaiverTouched(true);
                    setCountTowardFeeWaiver(event.target.checked);
                  }}
                  type="checkbox"
                />
                Count toward fee waiver
              </span>
              <span className="mt-1 block text-sm text-income/90">
                This counts toward your card&apos;s fee waiver progress
              </span>
            </label>
          ) : null}

          {type === TransactionType.REFUND ? (
            <label className="md:col-span-2">
              <span className="text-sm font-medium text-slate-700">
                Related Expense
              </span>
              <Input
                className="mt-1"
                onChange={(event) => setExpenseSearch(event.target.value)}
                placeholder="Search past expense transactions"
                type="search"
                value={expenseSearch}
              />
              <Select
                className="mt-2"
                defaultValue={initialValues?.relatedTransactionId ?? ""}
                name="relatedTransactionId"
              >
                <option value="">No linked purchase</option>
                {filteredExpenseTransactions.map((transaction) => (
                  <option key={transaction.id} value={transaction.id}>
                    {transaction.transactionDate} - {transaction.title} (
                    {transaction.amount})
                  </option>
                ))}
              </Select>
              <span className="mt-1 block text-sm text-slate-600">
                Link to the original purchase if possible
              </span>
            </label>
          ) : null}
        </div>
      </Card>

      {error ? (
        <p className="rounded-md border border-expense/20 bg-expense/10 px-3 py-2 text-sm text-expense">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/transactions">
          <Button className="w-full sm:w-auto" variant="outline">
            Cancel
          </Button>
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row">
          {isEdit ? (
            <Button
              disabled={isPending}
              onClick={() => setConfirmDeleteOpen(true)}
              type="button"
              variant="danger"
            >
              Delete
            </Button>
          ) : null}
          <Button disabled={isPending} loading={isPending} type="submit">
            {isEdit ? "Save Changes" : "Add Transaction"}
          </Button>
        </div>
      </div>
      {confirmDeleteOpen ? (
        <ConfirmDialog
          description="This transaction will be permanently removed."
          isPending={isPending}
          onCancel={() => setConfirmDeleteOpen(false)}
          onConfirm={handleDelete}
          title="Delete this transaction?"
        />
      ) : null}
    </form>
  );
}
