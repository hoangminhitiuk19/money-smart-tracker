import { TransactionType } from "@prisma/client";
import Link from "next/link";
import { Suspense } from "react";
import { TransactionForm } from "@/components/transaction-form";
import { PageHeader } from "@/components/ui/PageHeader";
import { listCategories } from "@/lib/actions/categories";
import { listMoneySources } from "@/lib/actions/money-sources";
import { listProjects } from "@/lib/actions/projects";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import NewTransactionLoading from "./loading";

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default function NewTransactionPage() {
  return (
    <Suspense fallback={<NewTransactionLoading />}>
      <NewTransactionPageContent />
    </Suspense>
  );
}

async function NewTransactionPageContent() {
  const user = await requireAuth();
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

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link
          className="text-sm font-medium text-primary hover:text-indigo-700"
          href="/transactions"
        >
          &larr; Back to transactions
        </Link>
        <PageHeader title="Add Transaction" />
      </div>

      <TransactionForm
        categories={categories.map((category) => ({
          id: category.id,
          name: category.name,
          defaultCountTowardFeeWaiver:
            category.defaultCountTowardFeeWaiver,
          defaultQualityRating: category.defaultQualityRating
        }))}
        expenseTransactions={expenseTransactions.map((transaction) => ({
          id: transaction.id,
          title: transaction.title,
          amount: transaction.amount.toString(),
          transactionDate: formatDateInput(transaction.transactionDate)
        }))}
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
