import { Card } from "@/components/ui/Card";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";

type ProtectedPageLoadingProps = {
  title: string;
  maxWidth?: string;
  formTitle?: string;
  cards?: number;
};

export function ProtectedPageLoading({
  title,
  maxWidth = "max-w-7xl",
  formTitle,
  cards = 3
}: ProtectedPageLoadingProps) {
  return (
    <div className={`mx-auto ${maxWidth} space-y-8`}>
      <PageHeader title={title} />
      {formTitle ? (
        <Card title={formTitle}>
          <div className="grid gap-3 md:grid-cols-3">
            <LoadingSkeleton height={44} rows={6} />
          </div>
        </Card>
      ) : null}
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: cards }).map((_, index) => (
          <Card key={index}>
            <LoadingSkeleton height={28} rows={4} />
          </Card>
        ))}
      </section>
      <Card>
        <LoadingSkeleton height={52} rows={5} />
      </Card>
    </div>
  );
}
