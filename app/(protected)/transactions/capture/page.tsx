import { TransactionType } from "@prisma/client";
import { z } from "zod";
import {
  CaptureCompletionCard,
  CaptureImportedNotice
} from "@/components/transaction-capture/CaptureCompletionCard";
import { CaptureWorkspace } from "@/components/transaction-capture/CaptureWorkspace";
import { CaptureMethodNav } from "@/components/transaction-capture/CaptureMethodNav";
import { listCategories } from "@/lib/actions/categories";
import { listMoneySources } from "@/lib/actions/money-sources";
import { listProjects } from "@/lib/actions/projects";
import { getUserSettings } from "@/lib/actions/settings";
import {
  loadTransactionCapture,
  type TransactionCaptureState
} from "@/lib/actions/transaction-drafts";
import { listTransactions } from "@/lib/actions/transactions";

type SearchParams = Record<string, string | string[] | undefined>;

const captureKeySchema = z.string().uuid();

// A present but malformed capture value is treated like any other unavailable
// capture rather than silently starting a new session.
function captureParamFromSearchParams(searchParams: SearchParams) {
  const capture = searchParams.capture;

  if (capture === undefined) return { present: false as const };
  return {
    present: true as const,
    captureKey:
      typeof capture === "string" && captureKeySchema.safeParse(capture).success
        ? capture
        : null
  };
}

function loadCaptureState(
  captureParam: ReturnType<typeof captureParamFromSearchParams>
): Promise<TransactionCaptureState | null> {
  if (!captureParam.present) return Promise.resolve(null);
  if (!captureParam.captureKey) {
    return Promise.resolve({ kind: "unavailable" });
  }
  return loadTransactionCapture(captureParam.captureKey);
}

type PageProps = {
  searchParams: Promise<SearchParams>;
};

export default async function TransactionCapturePage({
  searchParams
}: PageProps) {
  const captureParam = captureParamFromSearchParams(await searchParams);
  const captureKey = captureParam.present ? captureParam.captureKey : null;
  const [
    { settings },
    categories,
    moneySources,
    projects,
    { transactions: expenses },
    captureState
  ] = await Promise.all([
    getUserSettings(),
    listCategories(),
    listMoneySources(),
    listProjects(),
    listTransactions({ pageSize: 100, type: TransactionType.EXPENSE }),
    loadCaptureState(captureParam)
  ]);
  const methodNav = (
    <div className="min-w-0 bg-capture-canvas px-4 pt-4 font-capture-ui sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[90rem]">
        <CaptureMethodNav active="manual" />
      </div>
    </div>
  );

  if (captureState && captureState.kind !== "active") {
    return (
      <>
        {methodNav}
        <div className="min-w-0 bg-capture-canvas px-4 py-5 font-capture-ui sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl">
            <CaptureCompletionCard state={captureState} />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {methodNav}
      {captureState && captureState.importedCount > 0 ? (
        <div className="min-w-0 bg-capture-canvas px-4 pt-4 font-capture-ui sm:px-6 lg:px-8">
          <div className="mx-auto max-w-[90rem]">
            <CaptureImportedNotice count={captureState.importedCount} />
          </div>
        </div>
      ) : null}
      <CaptureWorkspace
        initialCaptureKey={captureKey}
        initialDrafts={captureState ? captureState.drafts : []}
        options={{
          categories: categories.map(
            ({ id, name, defaultQualityRating }) => ({
              id,
              name,
              defaultQualityRating
            })
          ),
          moneySources: moneySources.map(({ id, name, type }) => ({
            id,
            name,
            type
          })),
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
    </>
  );
}
