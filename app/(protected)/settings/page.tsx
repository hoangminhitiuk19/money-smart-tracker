import Link from "next/link";
import { SettingsForm } from "@/components/settings-form";
import { getUserSettings } from "@/lib/actions/settings";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function SettingsPage() {
  const { settings, user } = await getUserSettings();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <PageHeader
          action={
            <Link href="/api/export/transactions">
              <Button variant="outline">Export CSV</Button>
            </Link>
          }
          title="Settings"
        />
        <p className="text-sm text-slate-600">
          Manage app preferences, profile info, and account access.
        </p>
      </div>

      <SettingsForm
        initialValues={{
          dateFormat: settings.dateFormat,
          defaultCurrency: settings.defaultCurrency,
          defaultDashboardPeriod: settings.defaultDashboardPeriod,
          email: user.email,
          name: user.name,
          numberFormat: settings.numberFormat
        }}
      />

      <Card title="Notifications">
        <p className="text-sm text-slate-600">Coming soon</p>
      </Card>

      <Card title="App Theme">
        <p className="text-sm text-slate-600">Coming soon</p>
      </Card>
    </div>
  );
}
