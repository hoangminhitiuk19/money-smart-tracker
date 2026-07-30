import { TransactionType } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import {
  TransactionForm,
  type TransactionFormInitialValues
} from "@/components/transaction-form";
import { PageHeader } from "@/components/ui/PageHeader";
import { listCategories } from "@/lib/actions/categories";
import { listMoneySources } from "@/lib/actions/money-sources";
import { listProjects } from "@/lib/actions/projects";
import { getTransaction } from "@/lib/actions/transactions";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import EditTransactionLoading from "./loading";

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditTransactionPage({
  params
}: PageProps) {
  const { id } = await params;

  return (
    <Suspense fallback={<EditTransactionLoading />}>
      <EditTransactionPageContent id={id} />
    </Suspense>
  );
}

async function EditTransactionPageContent({
  id
}: {
  id: string;
}) {
  const user = await requireAuth();
  const transaction = await getTransaction(id).catch(() => notFound());
  const [categories, moneySources, projects, expenseTransactions] =
    await Promise.all([
      listCategories(),
      listMoneySources(),
      listProjects(),
      prisma.transaction.findMany({
        where: {
          userId: user.id,
          type: TransactionType.EXPENSE
        },
        orderBy: { transactionDate: "desc" },
        take: 100,
        select: {
          id: true,
          title: true,
          amount: true,
          transactionDate: true
        }
      })
    ]);

  const initialValues: TransactionFormInitialValues = {
    id: transaction.id,
    type: transaction.type,
    amount: transaction.amount.toString(),
    currency: transaction.currency,
    title: transaction.title,
    description: transaction.description ?? "",
    transactionDate: formatDateInput(transaction.transactionDate),
    categoryId: transaction.categoryId ?? "",
    qualityRating: transaction.qualityRating ?? "",
    fromMoneySourceId: transaction.fromMoneySourceId ?? "",
    toMoneySourceId: transaction.toMoneySourceId ?? "",
    adjustedMoneySourceId: transaction.adjustedMoneySourceId ?? "",
    adjustmentDirection: transaction.adjustmentDirection ?? "",
    adjustmentTarget: transaction.adjustmentTarget ?? "",
    projectId: transaction.projectId ?? "",
    relatedTransactionId: transaction.relatedTransactionId ?? "",
    countTowardFeeWaiver: transaction.countTowardFeeWaiver
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link
          className="text-sm font-medium text-primary hover:text-indigo-700"
          href="/transactions"
        >
          &larr; Back to transactions
        </Link>
        <PageHeader title="Edit Transaction" />
      </div>

      <TransactionForm
        categories={categories.map((category) => ({
          id: category.id,
          name: category.name,
          defaultCountTowardFeeWaiver:
            category.defaultCountTowardFeeWaiver,
          defaultQualityRating: category.defaultQualityRating
        }))}
        expenseTransactions={expenseTransactions.map((expenseTransaction) => ({
          id: expenseTransaction.id,
          title: expenseTransaction.title,
          amount: expenseTransaction.amount.toString(),
          transactionDate: formatDateInput(expenseTransaction.transactionDate)
        }))}
        initialValues={initialValues}
        moneySources={moneySources.map((moneySource) => ({
          id: moneySource.id,
          name: moneySource.name,
          type: moneySource.type
        }))}
        projects={projects.map((project) => ({
          id: project.id,
          name: project.name
        }))}
      />
    </div>
  );
}
