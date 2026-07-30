import { MoneySourceType } from "@prisma/client";
import Link from "next/link";
import { Suspense } from "react";
import {
  createMoneySourceFormAction,
  deleteMoneySourceFormAction,
  listMoneySources,
  toggleMoneySourceActiveFormAction
} from "@/lib/actions/money-sources";
import { requireAuth } from "@/lib/auth";
import { calculateTrackedBalance } from "@/lib/calc/balance";
import {
  presentationNumber,
  type DecimalInput
} from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import AccountsLoading from "./loading";

const sourceTypes = Object.values(MoneySourceType);

const typeLabels: Record<MoneySourceType, string> = {
  CASH: "Cash",
  BANK_ACCOUNT: "Bank Account",
  CREDIT_CARD: "Credit Card",
  DEBIT_CARD: "Debit Card",
  E_WALLET: "E-Wallet",
  INVESTMENT: "Investment",
  OTHER: "Other"
};

const typeIcons: Record<MoneySourceType, string> = {
  CASH: "CA",
  BANK_ACCOUNT: "BA",
  CREDIT_CARD: "CC",
  DEBIT_CARD: "DC",
  E_WALLET: "EW",
  INVESTMENT: "IN",
  OTHER: "OT"
};

const sourceTypeVariants = {
  CASH: "income",
  BANK_ACCOUNT: "transfer",
  CREDIT_CARD: "expense",
  DEBIT_CARD: "transfer",
  E_WALLET: "refund",
  INVESTMENT: "income",
  OTHER: "adjustment"
} as const;

function formatMoney(amount: DecimalInput, currency: string) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    style: "currency",
    currency
  }).format(presentationNumber(amount));
}

export default function AccountsPage() {
  return (
    <Suspense fallback={<AccountsLoading />}>
      <AccountsPageContent />
    </Suspense>
  );
}

async function AccountsPageContent() {
  const user = await requireAuth();
  const [moneySources, transactions] = await Promise.all([
    listMoneySources(),
    prisma.transaction.findMany({
      where: {
        userId: user.id,
        OR: [
          { fromMoneySourceId: { not: null } },
          { toMoneySourceId: { not: null } },
          { adjustedMoneySourceId: { not: null } }
        ]
      },
      select: {
        id: true,
        type: true,
        amount: true,
        fromMoneySourceId: true,
        toMoneySourceId: true,
        adjustedMoneySourceId: true,
        adjustmentDirection: true
      }
    })
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div>
        <PageHeader
          action={
            <a href="#add-account">
              <Button variant="primary">Add Account</Button>
            </a>
          }
          title="Accounts & Wallets"
        />
        <p className="mt-2 text-sm text-slate-600">
          Track app-side balances for cash, bank accounts, wallets, cards,
          and other money sources.
        </p>
      </div>

      <Card
        className="scroll-mt-6"
        title="Add Account"
      >
        <div className="scroll-mt-6" id="add-account" />
        <form
          action={createMoneySourceFormAction}
          className="mt-4 grid gap-3 md:grid-cols-6"
        >
          <label className="md:col-span-2">
            <span className="text-sm font-medium text-slate-700">Name</span>
            <Input className="mt-1" name="name" required />
          </label>
          <label>
            <span className="text-sm font-medium text-slate-700">Type</span>
            <Select
              className="mt-1"
              defaultValue={MoneySourceType.BANK_ACCOUNT}
              name="type"
              required
            >
              {sourceTypes.map((type) => (
                <option key={type} value={type}>
                  {typeLabels[type]}
                </option>
              ))}
            </Select>
          </label>
          <label>
            <span className="text-sm font-medium text-slate-700">Currency</span>
            <Input
              className="mt-1 uppercase"
              defaultValue="VND"
              name="currency"
              required
            />
          </label>
          <label>
            <span className="text-sm font-medium text-slate-700">Opening</span>
            <Input
              className="mt-1"
              defaultValue="0"
              name="openingBalance"
              step="0.01"
              type="number"
            />
          </label>
          <label>
            <span className="text-sm font-medium text-slate-700">Provider</span>
            <Input className="mt-1" name="providerName" placeholder="Optional" />
          </label>
          <label className="md:col-span-2">
            <span className="text-sm font-medium text-slate-700">Identifier</span>
            <Input
              className="mt-1"
              name="displayIdentifier"
              placeholder="Optional"
            />
          </label>
          <label className="md:col-span-3">
            <span className="text-sm font-medium text-slate-700">
              Description
            </span>
            <Input className="mt-1" name="description" placeholder="Optional" />
          </label>
          <label className="flex items-center gap-2 md:col-span-1 md:pt-7">
            <input defaultChecked name="isActive" type="checkbox" />
            <span className="text-sm font-medium text-slate-700">Active</span>
          </label>
          <div className="md:col-span-6 md:flex md:justify-end">
            <Button className="w-full md:w-auto" type="submit">
              Add Account
            </Button>
          </div>
        </form>
      </Card>

      {moneySources.length === 0 ? (
        <EmptyState
          cta={
            <a href="#add-account">
              <Button variant="primary">Add Account</Button>
            </a>
          }
          title={
            <>
              No accounts yet &mdash; Add your first account
            </>
          }
          subtitle="Add a wallet, bank account, card, or cash source to track balances."
        />
      ) : (
        <Card className="overflow-hidden" padded={false}>
          <div className="overflow-x-auto">
            <table className="min-w-[48rem] divide-y divide-slate-100 text-sm md:min-w-full">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Tracked</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {moneySources.map((source) => {
                  const balance = calculateTrackedBalance(source, transactions);
                  const toggleAction = toggleMoneySourceActiveFormAction.bind(
                    null,
                    source.id,
                    !source.isActive
                  );
                  const deleteAction = deleteMoneySourceFormAction.bind(
                    null,
                    source.id
                  );

                  return (
                    <tr className="transition hover:bg-slate-50/80" key={source.id}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-semibold text-slate-600">
                            {typeIcons[source.type]}
                          </span>
                          <div>
                            <Link
                              className="font-medium text-slate-950 hover:text-primary"
                              href={`/accounts/${source.id}`}
                            >
                              {source.name}
                            </Link>
                            {source.displayIdentifier ? (
                              <p className="text-xs text-slate-500">
                                {source.displayIdentifier}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <Badge
                          label={typeLabels[source.type]}
                          variant={sourceTypeVariants[source.type]}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-950">
                          {formatMoney(balance, source.currency)}
                        </div>
                        <div className="text-xs text-slate-500">Tracked</div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          label={source.isActive ? "Active" : "Inactive"}
                          variant={source.isActive ? "active" : "paused"}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <form action={toggleAction}>
                            <Button
                              size="sm"
                              variant="secondary"
                              type="submit"
                            >
                              {source.isActive ? "Deactivate" : "Activate"}
                            </Button>
                          </form>
                          <form action={deleteAction}>
                            <Button
                              size="sm"
                              variant="danger"
                              type="submit"
                            >
                              Delete
                            </Button>
                          </form>
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
