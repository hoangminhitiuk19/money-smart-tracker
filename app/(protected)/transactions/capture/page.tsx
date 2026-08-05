import { TransactionType } from "@prisma/client";
import { z } from "zod";
import { CaptureWorkspace } from "@/components/transaction-capture/CaptureWorkspace";
import { listCategories } from "@/lib/actions/categories";
import { listMoneySources } from "@/lib/actions/money-sources";
import { listProjects } from "@/lib/actions/projects";
import { getUserSettings } from "@/lib/actions/settings";
import { listTransactionDrafts } from "@/lib/actions/transaction-drafts";
import { listTransactions } from "@/lib/actions/transactions";

type SearchParams = Record<string, string | string[] | undefined>;

const captureKeySchema = z.string().uuid();

function captureKeyFromSearchParams(searchParams: SearchParams) {
  const capture = searchParams.capture;

  return typeof capture === "string" && captureKeySchema.safeParse(capture).success
    ? capture
    : null;
}

type PageProps = {
  searchParams: Promise<SearchParams>;
};

export default async function TransactionCapturePage({
  searchParams
}: PageProps) {
  const captureKey = captureKeyFromSearchParams(await searchParams);
  const [
    { settings },
    categories,
    moneySources,
    projects,
    { transactions: expenses },
    draftResult
  ] = await Promise.all([
    getUserSettings(),
    listCategories(),
    listMoneySources(),
    listProjects(),
    listTransactions({ pageSize: 100, type: TransactionType.EXPENSE }),
    captureKey
      ? listTransactionDrafts(captureKey)
      : Promise.resolve({ ok: true as const, drafts: [] })
  ]);

  return (
    <CaptureWorkspace
      initialCaptureKey={captureKey}
      initialDrafts={draftResult.ok ? draftResult.drafts : []}
      options={{
        categories: categories.map(({ id, name }) => ({ id, name })),
        moneySources: moneySources.map(({ id, name }) => ({ id, name })),
        projects: projects.map(({ id, name }) => ({ id, name })),
        expenses: expenses.map(({ amount, id, title, transactionDate }) => ({
          id,
          name: title,
          title,
          amount: amount.toString(),
          transactionDate: transactionDate.toISOString().slice(0, 10)
        }))
      }}
      settings={{
        defaultCurrency: settings.defaultCurrency,
        dateFormat: settings.dateFormat,
        numberFormat: settings.numberFormat
      }}
    />
  );
}
