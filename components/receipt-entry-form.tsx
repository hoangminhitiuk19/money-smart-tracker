"use client";

import { QualityRating, TransactionType } from "@prisma/client";
import { useRouter } from "next/navigation";
import type { ChangeEvent } from "react";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { UploadIcon } from "@/components/ui/icons";
import {
  createTransaction,
  type TransactionFormInput
} from "@/lib/actions/transactions";

type CategoryOption = {
  id: string;
  name: string;
  defaultQualityRating: QualityRating | null;
};

type MoneySourceOption = {
  id: string;
  name: string;
};

type ReceiptEntryFormProps = {
  categories: CategoryOption[];
  moneySources: MoneySourceOption[];
};

const qualityRatings = Object.values(QualityRating);

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function emptyToUndefined(value: FormDataEntryValue | null) {
  const text = value?.toString().trim() ?? "";
  return text ? text : undefined;
}

export function ReceiptEntryForm({
  categories,
  moneySources
}: ReceiptEntryFormProps) {
  const router = useRouter();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [qualityRating, setQualityRating] = useState<QualityRating | "">("");
  const [qualityTouched, setQualityTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const selectedCategory = categories.find(
    (category) => category.id === categoryId
  );

  useEffect(() => {
    if (selectedCategory?.defaultQualityRating && !qualityTouched) {
      setQualityRating(selectedCategory.defaultQualityRating);
    }
  }, [qualityTouched, selectedCategory]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setPreviewUrl(file ? URL.createObjectURL(file) : null);
  }

  function handleSubmit(formData: FormData) {
    setError(null);

    const payload: TransactionFormInput = {
      amount: String(formData.get("amount") ?? ""),
      categoryId: categoryId || undefined,
      currency: "VND",
      description: emptyToUndefined(formData.get("description")),
      fromMoneySourceId: emptyToUndefined(formData.get("fromMoneySourceId")),
      isInstallmentRelated: false,
      qualityRating: qualityRating || undefined,
      title: formData.get("title")?.toString() ?? "",
      transactionDate: formData.get("transactionDate")?.toString() ?? "",
      type: TransactionType.EXPENSE
    };

    startTransition(async () => {
      const result = await createTransaction(payload);

      if (!result.ok) {
        setError(result.error ?? "Unable to create transaction.");
        return;
      }

      router.push("/transactions?created=receipt");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Card className="border-dashed">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Receipt Image
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Receipt scanning coming soon
            </p>
          </div>
          <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 md:min-h-0">
            <UploadIcon className="h-4 w-4" />
            Upload Receipt
            <input
              accept="image/*"
              className="sr-only"
              onChange={handleFileChange}
              type="file"
            />
          </label>
        </div>

        {previewUrl ? (
          <div className="relative mt-5 min-h-80 overflow-hidden rounded-md border border-slate-200 bg-slate-50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt="Receipt preview"
              className="absolute inset-0 h-full w-full object-contain"
              src={previewUrl}
            />
          </div>
        ) : (
          <div className="mt-5 flex min-h-56 items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-4 text-center text-sm text-slate-500">
            Select an image to preview it here.
          </div>
        )}
      </Card>

      <Card title="Manual Expense Entry">
        <form
          className="space-y-6"
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
                name="transactionDate"
                required
                type="date"
              />
            </label>

            <label>
              <span className="text-sm font-medium text-slate-700">
                Merchant / Title
              </span>
              <Input className="mt-1" name="title" required />
            </label>

            <label>
              <span className="text-sm font-medium text-slate-700">
                Money Source
              </span>
              <Select className="mt-1" name="fromMoneySourceId" required>
                <option value="">Select source</option>
                {moneySources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
              </Select>
            </label>

            <label>
              <span className="text-sm font-medium text-slate-700">Category</span>
              <Select
                className="mt-1"
                onChange={(event) => {
                  setCategoryId(event.target.value);
                  setQualityTouched(false);
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

            <label className="md:col-span-2">
              <span className="text-sm font-medium text-slate-700">
                Description / Note
              </span>
              <textarea
                className="mt-1 min-h-28 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                name="description"
              />
            </label>
          </div>

          {error ? (
            <p className="rounded-md border border-expense/20 bg-expense/10 px-3 py-2 text-sm text-expense">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end">
            <Button loading={isPending} type="submit">
              Create Transaction
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
