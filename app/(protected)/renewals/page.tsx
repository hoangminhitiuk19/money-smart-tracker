import {
  QualityRating,
  RenewalFrequency,
  RenewalStatus,
  TransactionType
} from "@prisma/client";
import Link from "next/link";
import { Suspense } from "react";
import { RenewalDeleteButton } from "@/components/renewal-delete-button";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { listCategories } from "@/lib/actions/categories";
import { listMoneySources } from "@/lib/actions/money-sources";
import { listProjects } from "@/lib/actions/projects";
import {
  cancelRenewalFormAction,
  createRenewalFormAction,
  getUpcomingRenewals,
  listRenewals,
  markRenewalAsPaidFormAction,
  pauseRenewalFormAction,
  resumeRenewalFormAction,
  skipRenewalCycleFormAction,
  updateRenewalFormAction
} from "@/lib/actions/renewals";
import RenewalsLoading from "./loading";

type SearchParams = Record<string, string | string[] | undefined>;

type RenewalWithRelations = Awaited<ReturnType<typeof listRenewals>>[number];
type CategoryOption = Awaited<ReturnType<typeof listCategories>>[number];
type MoneySourceOption = Awaited<ReturnType<typeof listMoneySources>>[number];
type ProjectOption = Awaited<ReturnType<typeof listProjects>>[number];

const renewalStatuses = Object.values(RenewalStatus);
const renewalFrequencies = Object.values(RenewalFrequency);
const transactionTypes = Object.values(TransactionType);
const qualityRatings = Object.values(QualityRating);

const statusVariants = {
  ACTIVE: "active",
  CANCELLED: "paused",
  PAUSED: "adjustment"
} as const;

function getParam(searchParams: SearchParams, key: string) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function parseStatus(value: string | undefined) {
  return value && renewalStatuses.includes(value as RenewalStatus)
    ? (value as RenewalStatus)
    : RenewalStatus.ACTIVE;
}

function formatMoney(amount: unknown, currency: string) {
  return new Intl.NumberFormat("en-US", {
    currency,
    maximumFractionDigits: 2,
    style: "currency"
  }).format(Number(amount));
}

function formatDateInput(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : "";
}

function daysUntil(date: Date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const target = new Date(date);
  target.setHours(0, 0, 0, 0);

  return Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
}

function renewalCadence(renewal: RenewalWithRelations) {
  const interval =
    renewal.intervalCount === 1 ? "" : `Every ${renewal.intervalCount} `;

  if (renewal.intervalCount === 1) {
    return renewal.frequency.toLowerCase();
  }

  return `${interval}${renewal.frequency.toLowerCase()}`;
}

function RenewalFormFields({
  categories,
  moneySources,
  projects,
  renewal
}: {
  categories: CategoryOption[];
  moneySources: MoneySourceOption[];
  projects: ProjectOption[];
  renewal?: RenewalWithRelations;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-6">
      <label className="md:col-span-2">
        <span className="text-sm font-medium text-slate-700">Title</span>
        <Input className="mt-1" defaultValue={renewal?.title ?? ""} name="title" required />
      </label>
      <label>
        <span className="text-sm font-medium text-slate-700">Amount</span>
        <Input
          className="mt-1"
          defaultValue={renewal?.amount.toString() ?? ""}
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
          defaultValue={renewal?.currency ?? "VND"}
          name="currency"
          required
        />
      </label>
      <label>
        <span className="text-sm font-medium text-slate-700">Type</span>
        <Select
          className="mt-1"
          defaultValue={renewal?.transactionType ?? TransactionType.EXPENSE}
          name="transactionType"
        >
          {transactionTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </Select>
      </label>
      <label>
        <span className="text-sm font-medium text-slate-700">Status</span>
        <Select
          className="mt-1"
          defaultValue={renewal?.status ?? RenewalStatus.ACTIVE}
          name="status"
        >
          {renewalStatuses.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </Select>
      </label>
      <label>
        <span className="text-sm font-medium text-slate-700">Frequency</span>
        <Select
          className="mt-1"
          defaultValue={renewal?.frequency ?? RenewalFrequency.MONTHLY}
          name="frequency"
        >
          {renewalFrequencies.map((frequency) => (
            <option key={frequency} value={frequency}>
              {frequency}
            </option>
          ))}
        </Select>
      </label>
      <label>
        <span className="text-sm font-medium text-slate-700">Interval</span>
        <Input
          className="mt-1"
          defaultValue={renewal?.intervalCount ?? 1}
          min="1"
          name="intervalCount"
          required
          type="number"
        />
      </label>
      <label>
        <span className="text-sm font-medium text-slate-700">Next Due</span>
        <Input
          className="mt-1"
          defaultValue={
            renewal ? formatDateInput(renewal.nextDueDate) : formatDateInput(new Date())
          }
          name="nextDueDate"
          required
          type="date"
        />
      </label>
      <label>
        <span className="text-sm font-medium text-slate-700">Reminder</span>
        <Input
          className="mt-1"
          defaultValue={renewal?.reminderDaysBefore ?? 3}
          min="0"
          name="reminderDaysBefore"
          required
          type="number"
        />
      </label>
      <label>
        <span className="text-sm font-medium text-slate-700">From</span>
        <Select className="mt-1" defaultValue={renewal?.fromMoneySourceId ?? ""} name="fromMoneySourceId">
          <option value="">None</option>
          {moneySources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.name}
            </option>
          ))}
        </Select>
      </label>
      <label>
        <span className="text-sm font-medium text-slate-700">To</span>
        <Select className="mt-1" defaultValue={renewal?.toMoneySourceId ?? ""} name="toMoneySourceId">
          <option value="">None</option>
          {moneySources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.name}
            </option>
          ))}
        </Select>
      </label>
      <label>
        <span className="text-sm font-medium text-slate-700">Category</span>
        <Select className="mt-1" defaultValue={renewal?.categoryId ?? ""} name="categoryId">
          <option value="">None</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
      </label>
      <label>
        <span className="text-sm font-medium text-slate-700">Project</span>
        <Select className="mt-1" defaultValue={renewal?.projectId ?? ""} name="projectId">
          <option value="">None</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </Select>
      </label>
      <label>
        <span className="text-sm font-medium text-slate-700">Quality</span>
        <Select className="mt-1" defaultValue={renewal?.qualityRating ?? ""} name="qualityRating">
          <option value="">None</option>
          {qualityRatings.map((rating) => (
            <option key={rating} value={rating}>
              {rating}
            </option>
          ))}
        </Select>
      </label>
      <label className="md:col-span-3">
        <span className="text-sm font-medium text-slate-700">Description</span>
        <Input
          className="mt-1"
          defaultValue={renewal?.description ?? ""}
          name="description"
          placeholder="Optional"
        />
      </label>
      <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 md:col-span-2 md:mt-6">
        <input
          defaultChecked={renewal?.countTowardFeeWaiver ?? false}
          name="countTowardFeeWaiver"
          type="checkbox"
        />
        <span className="text-sm font-medium text-slate-700">
          Count toward fee waiver
        </span>
      </label>
      <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 md:col-span-1 md:mt-6">
        <input
          defaultChecked={renewal?.autoCreateTransaction ?? false}
          name="autoCreateTransaction"
          type="checkbox"
        />
        <span className="text-sm font-medium text-slate-700">Auto</span>
      </label>
    </div>
  );
}

function RenewalRow({
  categories,
  moneySources,
  projects,
  renewal
}: {
  categories: CategoryOption[];
  moneySources: MoneySourceOption[];
  projects: ProjectOption[];
  renewal: RenewalWithRelations;
}) {
  const markPaidAction = markRenewalAsPaidFormAction.bind(null, renewal.id);
  const skipAction = skipRenewalCycleFormAction.bind(null, renewal.id);
  const pauseAction = pauseRenewalFormAction.bind(null, renewal.id);
  const resumeAction = resumeRenewalFormAction.bind(null, renewal.id);
  const cancelAction = cancelRenewalFormAction.bind(null, renewal.id);
  const updateAction = updateRenewalFormAction.bind(null, renewal.id);
  const dueInDays = daysUntil(renewal.nextDueDate);

  return (
    <Card hover padded={false} className="p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-slate-950">
              {renewal.title}
            </h3>
            <Badge
              label={renewal.status}
              variant={statusVariants[renewal.status]}
            />
          </div>
          <p className="mt-2 text-sm text-slate-600">
            {formatMoney(renewal.amount, renewal.currency)} &middot;{" "}
            {renewal.transactionType} &middot; {renewalCadence(renewal)}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Due {renewal.nextDueDate.toLocaleDateString("en-US")} ({dueInDays}{" "}
            days)
          </p>
          <p className="mt-1 text-xs text-slate-500">
            From {renewal.fromMoneySource?.name ?? "None"} / To{" "}
            {renewal.toMoneySource?.name ?? "None"}
          </p>
        </div>

        <details className="relative shrink-0">
          <summary className="min-h-11 cursor-pointer list-none rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 md:min-h-0 [&::-webkit-details-marker]:hidden">
            Actions
          </summary>
          <div className="mt-2 w-full rounded-md border border-slate-200 bg-white p-2 shadow-md lg:absolute lg:right-0 lg:z-10 lg:w-56">
            {renewal.status === RenewalStatus.ACTIVE ? (
              <>
                <form action={markPaidAction}>
                  <button
                    className="min-h-11 w-full rounded px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 md:min-h-0"
                    type="submit"
                  >
                    Mark as Paid
                  </button>
                </form>
                <form action={skipAction}>
                  <button
                    className="min-h-11 w-full rounded px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 md:min-h-0"
                    type="submit"
                  >
                    Skip
                  </button>
                </form>
                <form action={pauseAction}>
                  <button
                    className="min-h-11 w-full rounded px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 md:min-h-0"
                    type="submit"
                  >
                    Pause
                  </button>
                </form>
              </>
            ) : renewal.status === RenewalStatus.PAUSED ? (
              <form action={resumeAction}>
                <button
                  className="min-h-11 w-full rounded px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 md:min-h-0"
                  type="submit"
                >
                  Resume
                </button>
              </form>
            ) : null}
            {renewal.status !== RenewalStatus.CANCELLED ? (
              <form action={cancelAction}>
                <button
                  className="min-h-11 w-full rounded px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 md:min-h-0"
                  type="submit"
                >
                  Cancel
                </button>
              </form>
            ) : null}
            <a
              className="block min-h-11 rounded px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 md:min-h-0"
              href={`#edit-${renewal.id}`}
            >
              Edit
            </a>
            <RenewalDeleteButton id={renewal.id} />
          </div>
        </details>
      </div>

      <details className="mt-4 scroll-mt-6 rounded-md border border-slate-200 bg-slate-50 p-3" id={`edit-${renewal.id}`}>
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">
          Edit renewal
        </summary>
        <form action={updateAction} className="mt-3 space-y-3">
          <RenewalFormFields
            categories={categories}
            moneySources={moneySources}
            projects={projects}
            renewal={renewal}
          />
          <Button size="sm" type="submit" variant="secondary">
            Save Renewal
          </Button>
        </form>
      </details>
    </Card>
  );
}

export default function RenewalsPage({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  return (
    <Suspense fallback={<RenewalsLoading />}>
      <RenewalsPageContent searchParams={searchParams} />
    </Suspense>
  );
}

async function RenewalsPageContent({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  const selectedStatus = parseStatus(getParam(searchParams, "status"));
  const [renewals, upcomingRenewals, categories, moneySources, projects] =
    await Promise.all([
      listRenewals({ status: selectedStatus }),
      getUpcomingRenewals(),
      listCategories(),
      listMoneySources(),
      listProjects()
    ]);

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <div>
        <PageHeader
          action={
            <a href="#add-renewal">
              <Button variant="primary">Add Renewal</Button>
            </a>
          }
          title="Renewals"
        />
        <p className="mt-2 text-sm text-slate-600">
          Track recurring payments, subscriptions, transfers, and reminders.
        </p>
      </div>

      <Card title="Add Renewal">
        <div className="scroll-mt-6" id="add-renewal" />
        <form action={createRenewalFormAction} className="mt-4 space-y-3">
          <RenewalFormFields
            categories={categories}
            moneySources={moneySources}
            projects={projects}
          />
          <div className="flex justify-end">
            <Button type="submit">Add Renewal</Button>
          </div>
        </form>
      </Card>

      <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-950">
              Upcoming
            </h2>
            <p className="text-sm text-slate-700">
              Active renewals inside their reminder window.
            </p>
          </div>
          <span className="text-sm font-medium text-slate-700">
            {upcomingRenewals.length} due
          </span>
        </div>
        <div className="mt-4 grid gap-3">
          {upcomingRenewals.length === 0 ? (
            <p className="rounded-md border border-amber-100 bg-white/70 p-4 text-sm text-slate-700">
              No renewals are inside their reminder window.
            </p>
          ) : (
            upcomingRenewals.map((renewal) => (
              <RenewalRow
                categories={categories}
                key={renewal.id}
                moneySources={moneySources}
                projects={projects}
                renewal={renewal}
              />
            ))
          )}
        </div>
      </section>

      <section className="space-y-4">
        <nav className="inline-flex w-fit gap-1 rounded-lg bg-slate-100 p-1">
          {renewalStatuses.map((status) => (
            <Link
              className={[
                "min-h-9 rounded-md px-3 py-1.5 text-sm font-medium transition md:min-h-0",
                selectedStatus === status
                  ? "bg-white text-slate-950 shadow-sm"
                  : "text-slate-600 hover:text-slate-950"
              ].join(" ")}
              href={`/renewals?status=${status}`}
              key={status}
            >
              {status}
            </Link>
          ))}
        </nav>

        {renewals.length === 0 ? (
          <EmptyState
            cta={
              <a href="#add-renewal">
                <Button variant="primary">Add Subscription</Button>
              </a>
            }
            title={
              <>
                No renewals yet &mdash; Add your first subscription
              </>
            }
            subtitle="Track recurring payments, subscriptions, transfers, and reminders."
          />
        ) : (
          <div className="grid gap-4">
            {renewals.map((renewal) => (
              <RenewalRow
                categories={categories}
                key={renewal.id}
                moneySources={moneySources}
                projects={projects}
                renewal={renewal}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
