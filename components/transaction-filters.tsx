"use client";

import { QualityRating, TransactionType } from "@prisma/client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";

type FilterOption = {
  id: string;
  name: string;
};

type TransactionFiltersProps = {
  categories: FilterOption[];
  moneySources: FilterOption[];
  projects: FilterOption[];
};

const transactionTypes = Object.values(TransactionType);
const qualityRatings = Object.values(QualityRating);

export function TransactionFilters({
  categories,
  moneySources,
  projects
}: TransactionFiltersProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");

  const currentValues = useMemo(
    () => ({
      categoryId: searchParams.get("categoryId") ?? "",
      endDate: searchParams.get("endDate") ?? "",
      moneySourceId: searchParams.get("moneySourceId") ?? "",
      pageSize: searchParams.get("pageSize") ?? "20",
      projectId: searchParams.get("projectId") ?? "",
      qualityRating: searchParams.get("qualityRating") ?? "",
      startDate: searchParams.get("startDate") ?? "",
      type: searchParams.get("type") ?? ""
    }),
    [searchParams]
  );

  const updateParam = useCallback(
    (name: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());

      if (value) {
        params.set(name, value);
      } else {
        params.delete(name);
      }

      params.delete("page");
      const queryString = params.toString();
      router.push(queryString ? `${pathname}?${queryString}` : pathname);
    },
    [pathname, router, searchParams]
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      updateParam("q", query.trim());
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [query, updateParam]);

  useEffect(() => {
    setQuery(searchParams.get("q") ?? "");
  }, [searchParams]);

  return (
    <div className="rounded-xl border border-slate-200/70 bg-card-bg p-4 shadow-sm">
      <div className="grid gap-3 md:grid-cols-6">
        <label className="md:col-span-2">
          <span className="text-sm font-medium text-slate-700">Search</span>
          <Input
            className="mt-1"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Title or description"
            type="search"
            value={query}
          />
        </label>

        <label>
          <span className="text-sm font-medium text-slate-700">Type</span>
          <Select
            className="mt-1"
            onChange={(event) => updateParam("type", event.target.value)}
            value={currentValues.type}
          >
            <option value="">All types</option>
            {transactionTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </Select>
        </label>

        <label>
          <span className="text-sm font-medium text-slate-700">Category</span>
          <Select
            className="mt-1"
            onChange={(event) => updateParam("categoryId", event.target.value)}
            value={currentValues.categoryId}
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </label>

        <label>
          <span className="text-sm font-medium text-slate-700">Quality</span>
          <Select
            className="mt-1"
            onChange={(event) =>
              updateParam("qualityRating", event.target.value)
            }
            value={currentValues.qualityRating}
          >
            <option value="">All ratings</option>
            {qualityRatings.map((rating) => (
              <option key={rating} value={rating}>
                {rating}
              </option>
            ))}
          </Select>
        </label>

        <label>
          <span className="text-sm font-medium text-slate-700">Source</span>
          <Select
            className="mt-1"
            onChange={(event) =>
              updateParam("moneySourceId", event.target.value)
            }
            value={currentValues.moneySourceId}
          >
            <option value="">All sources</option>
            {moneySources.map((moneySource) => (
              <option key={moneySource.id} value={moneySource.id}>
                {moneySource.name}
              </option>
            ))}
          </Select>
        </label>

        <label>
          <span className="text-sm font-medium text-slate-700">Project</span>
          <Select
            className="mt-1"
            onChange={(event) => updateParam("projectId", event.target.value)}
            value={currentValues.projectId}
          >
            <option value="">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
        </label>

        <label>
          <span className="text-sm font-medium text-slate-700">Start</span>
          <Input
            className="mt-1"
            onChange={(event) => updateParam("startDate", event.target.value)}
            type="date"
            value={currentValues.startDate}
          />
        </label>

        <label>
          <span className="text-sm font-medium text-slate-700">End</span>
          <Input
            className="mt-1"
            onChange={(event) => updateParam("endDate", event.target.value)}
            type="date"
            value={currentValues.endDate}
          />
        </label>

        <label>
          <span className="text-sm font-medium text-slate-700">Page Size</span>
          <Select
            className="mt-1"
            onChange={(event) => updateParam("pageSize", event.target.value)}
            value={currentValues.pageSize}
          >
            {[10, 20, 50, 100].map((pageSize) => (
              <option key={pageSize} value={pageSize}>
                {pageSize}
              </option>
            ))}
          </Select>
        </label>
      </div>
    </div>
  );
}
