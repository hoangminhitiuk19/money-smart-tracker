import { MoneySourceType } from "@prisma/client";
import Link from "next/link";
import { Suspense } from "react";
import {
  deleteMoneySourceFormAction,
  listMoneySources,
  toggleMoneySourceActiveFormAction
} from "@/lib/actions/money-sources";
import { getUserSettings } from "@/lib/actions/settings";
import { calculateAccountProjection } from "@/lib/calc/dashboard";
import { type DecimalInput } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import {
  formatUserMoney,
  type UserFormatSettings
} from "@/lib/user-format";
import { MoneySourceForm } from "@/components/money-source-form";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import AccountsLoading from "./loading";

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

export default function AccountsPage() {
  return (
    <Suspense fallback={<AccountsLoading />}>
      <AccountsPageContent />
    </Suspense>
  );
}

async function AccountsPageContent() {
  const { settings, user } = await getUserSettings();
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
        transactionDate: true,
        createdAt: true,
        fromMoneySourceId: true,
        toMoneySourceId: true,
        adjustedMoneySourceId: true,
        adjustmentDirection: true,
        adjustmentTarget: true
      }
    })
  ]);
  const formatSettings: UserFormatSettings = {
    defaultCurrency: settings.defaultCurrency,
    dateFormat: settings.dateFormat as UserFormatSettings["dateFormat"],
    numberFormat: settings.numberFormat as UserFormatSettings["numberFormat"]
  };
  const formatMoney = (amount: DecimalInput, currency: string) =>
    formatUserMoney(amount, currency, formatSettings);

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

      <div className="scroll-mt-6" id="add-account">
        <MoneySourceForm defaultCurrency={settings.defaultCurrency} />
      </div>

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
                  const projection = calculateAccountProjection(
                    source,
                    transactions
                  );
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
                          {formatMoney(
                            projection.trackedAmount,
                            source.currency
                          )}
                        </div>
                        <div className="text-xs text-slate-500">
                          {source.type === MoneySourceType.CREDIT_CARD
                            ? "Tracked debt"
                            : "Tracked"}
                        </div>
                        {projection.cardCredit?.gt(0) ? (
                          <div className="mt-1 text-xs font-medium text-emerald-700">
                            Card credit:{" "}
                            {formatMoney(
                              projection.cardCredit,
                              source.currency
                            )}
                          </div>
                        ) : null}
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
