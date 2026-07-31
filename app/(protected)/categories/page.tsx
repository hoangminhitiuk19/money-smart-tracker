import { CategoryType, QualityRating } from "@prisma/client";
import { Suspense } from "react";
import {
  createCategoryFormAction,
  deleteCategoryFormAction,
  listCategories,
  updateCategoryFormAction
} from "@/lib/actions/categories";
import { DestructiveActionButton } from "@/components/destructive-action-button";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import CategoriesLoading from "./loading";

const categoryTypes = Object.values(CategoryType);
const qualityRatings = Object.values(QualityRating);

const categoryTypeVariants = {
  INCOME: "income",
  EXPENSE: "expense",
  BOTH: "adjustment",
  TRANSFER: "transfer",
  OTHER: "adjustment"
} as const;

const qualityVariants = {
  S: "s",
  A: "a",
  B: "b",
  C: "c",
  D: "d"
} as const;

function QualityBadge({ rating }: { rating: QualityRating | null }) {
  if (!rating) {
    return <span className="text-sm text-slate-400">None</span>;
  }

  return <Badge label={rating} variant={qualityVariants[rating]} />;
}

function TypeSelect({
  defaultValue,
  form,
  id
}: {
  defaultValue?: CategoryType;
  form?: string;
  id: string;
}) {
  return (
    <Select defaultValue={defaultValue} form={form} id={id} name="type" required>
      {categoryTypes.map((type) => (
        <option key={type} value={type}>
          {type}
        </option>
      ))}
    </Select>
  );
}

function QualitySelect({
  defaultValue,
  form,
  id
}: {
  defaultValue?: QualityRating | null;
  form?: string;
  id: string;
}) {
  return (
    <Select defaultValue={defaultValue ?? ""} form={form} id={id} name="defaultQualityRating">
      <option value="">None</option>
      {qualityRatings.map((rating) => (
        <option key={rating} value={rating}>
          {rating}
        </option>
      ))}
    </Select>
  );
}

export default function CategoriesPage() {
  return (
    <Suspense fallback={<CategoriesLoading />}>
      <CategoriesPageContent />
    </Suspense>
  );
}

async function CategoriesPageContent() {
  const categories = await listCategories();

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div>
        <PageHeader title="Categories" />
        <p className="mt-2 text-sm text-slate-600">
          Create category defaults that make transaction entry faster and more
          consistent.
        </p>
      </div>

      <Card title="Add Category">
        <form
          className="mt-4 grid gap-3 md:grid-cols-6"
          action={createCategoryFormAction}
        >
          <label className="md:col-span-2">
            <span className="text-sm font-medium text-slate-700">Name</span>
            <Input className="mt-1" name="name" required />
          </label>
          <label>
            <span className="text-sm font-medium text-slate-700">Type</span>
            <div className="mt-1">
              <TypeSelect defaultValue={CategoryType.EXPENSE} id="new-type" />
            </div>
          </label>
          <label>
            <span className="text-sm font-medium text-slate-700">Rating</span>
            <div className="mt-1">
              <QualitySelect id="new-rating" />
            </div>
          </label>
          <label>
            <span className="text-sm font-medium text-slate-700">Color</span>
            <input
              className="mt-1 h-11 w-full rounded-md border border-slate-300 px-2 md:h-10"
              name="color"
              type="color"
              defaultValue="#10b981"
            />
          </label>
          <label>
            <span className="text-sm font-medium text-slate-700">Icon</span>
            <Input className="mt-1" name="icon" placeholder="Optional" />
          </label>
          <label className="flex min-h-11 items-center gap-2 md:col-span-2 md:min-h-0">
            <input name="isDefault" type="checkbox" />
            <span className="text-sm font-medium text-slate-700">Default</span>
          </label>
          <label className="flex min-h-11 items-center gap-2 md:col-span-4 md:min-h-0">
            <input
              defaultChecked
              name="defaultCountTowardFeeWaiver"
              type="checkbox"
            />
            <span className="text-sm font-medium text-slate-700">
              Count credit-card expenses in this category toward fee waiver by
              default
            </span>
          </label>
          <div className="md:col-span-6 md:flex md:justify-end">
            <Button className="w-full md:w-auto" type="submit">
              Add Category
            </Button>
          </div>
        </form>
      </Card>

      {categories.length === 0 ? (
        <EmptyState
          title="No categories yet"
          subtitle="Add your first category above to start organizing transactions."
        />
      ) : (
        <Card className="overflow-hidden" padded={false}>
          <div className="overflow-x-auto">
            <table className="min-w-[52rem] divide-y divide-slate-100 text-sm md:min-w-full">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Default Quality</th>
                  <th className="px-4 py-3">Color</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {categories.map((category) => {
                  const updateAction = updateCategoryFormAction.bind(
                    null,
                    category.id
                  );
                  const deleteAction = deleteCategoryFormAction.bind(
                    null,
                    category.id
                  );

                  return (
                    <tr className="align-top transition hover:bg-slate-50/80" key={category.id}>
                      <td className="px-4 py-3">
                        <form
                          action={updateAction}
                          className="grid min-w-80 gap-2"
                          id={`category-${category.id}`}
                        >
                          <Input
                            className="font-medium"
                            name="name"
                            defaultValue={category.name}
                            required
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <Input
                              name="icon"
                              defaultValue={category.icon ?? ""}
                              placeholder="Icon"
                            />
                            <label className="flex items-center gap-2 text-sm text-slate-700">
                              <input
                                name="isDefault"
                                type="checkbox"
                                defaultChecked={category.isDefault}
                              />
                              Default
                            </label>
                          </div>
                          <label className="flex items-start gap-2 text-sm text-slate-700">
                            <input
                              className="mt-0.5"
                              defaultChecked={
                                category.defaultCountTowardFeeWaiver
                              }
                              name="defaultCountTowardFeeWaiver"
                              type="checkbox"
                            />
                            Count credit-card expenses in this category toward
                            fee waiver by default
                          </label>
                        </form>
                      </td>
                      <td className="px-4 py-3">
                        <div className="mb-2">
                          <Badge
                            label={category.type}
                            variant={categoryTypeVariants[category.type]}
                          />
                        </div>
                        <TypeSelect
                          defaultValue={category.type}
                          form={`category-${category.id}`}
                          id={`type-${category.id}`}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="mb-2">
                          <QualityBadge rating={category.defaultQualityRating} />
                        </div>
                        <QualitySelect
                          defaultValue={category.defaultQualityRating}
                          form={`category-${category.id}`}
                          id={`rating-${category.id}`}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span
                            className="h-7 w-7 rounded-md border border-slate-300"
                            style={{
                              backgroundColor: category.color ?? "#e2e8f0"
                            }}
                          />
                          <input
                            className="h-11 w-14 rounded-md border border-slate-300 px-1 md:h-9"
                            form={`category-${category.id}`}
                            name="color"
                            type="color"
                            defaultValue={category.color ?? "#64748b"}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <Button
                            form={`category-${category.id}`}
                            size="sm"
                            variant="secondary"
                            type="submit"
                          >
                            Save
                          </Button>
                          <DestructiveActionButton
                            action={deleteAction}
                            description="This category will be permanently removed."
                            itemLabel={`${category.name} category`}
                            title="Delete this category?"
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
