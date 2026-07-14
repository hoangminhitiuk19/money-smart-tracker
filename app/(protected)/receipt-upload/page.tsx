import Link from "next/link";
import { ReceiptEntryForm } from "@/components/receipt-entry-form";
import { PageHeader } from "@/components/ui/PageHeader";
import { listCategories } from "@/lib/actions/categories";
import { listMoneySources } from "@/lib/actions/money-sources";

export default async function ReceiptUploadPage() {
  const [categories, moneySources] = await Promise.all([
    listCategories(),
    listMoneySources()
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
        <PageHeader title="Receipt Upload" />
        <p className="text-sm text-slate-600">
          Preview a receipt image and enter the expense manually.
        </p>
      </div>

      <ReceiptEntryForm
        categories={categories.map((category) => ({
          id: category.id,
          name: category.name,
          defaultQualityRating: category.defaultQualityRating
        }))}
        moneySources={moneySources.map((moneySource) => ({
          id: moneySource.id,
          name: moneySource.name
        }))}
      />
    </div>
  );
}
