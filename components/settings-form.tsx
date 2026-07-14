"use client";

import { useFormState } from "react-dom";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  updateUserSettings,
  type SettingsState
} from "@/lib/actions/settings";

type SettingsFormProps = {
  initialValues: {
    dateFormat: string;
    defaultCurrency: string;
    defaultDashboardPeriod: string;
    email: string;
    name: string;
    numberFormat: string;
  };
};

const initialState: SettingsState = {};

export function SettingsForm({ initialValues }: SettingsFormProps) {
  const [state, formAction] = useFormState(updateUserSettings, initialState);

  return (
    <form action={formAction} className="space-y-6">
      <Card title="Preferences">
        <div className="grid gap-4 md:grid-cols-2">
          <label>
            <span className="text-sm font-medium text-slate-700">
              Default currency
            </span>
            <Input
              className="mt-1 uppercase"
              defaultValue={initialValues.defaultCurrency}
              name="defaultCurrency"
              required
            />
          </label>

          <label>
            <span className="text-sm font-medium text-slate-700">
              Date format
            </span>
            <Select className="mt-1" defaultValue={initialValues.dateFormat} name="dateFormat">
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD</option>
            </Select>
          </label>

          <label>
            <span className="text-sm font-medium text-slate-700">
              Number format
            </span>
            <Select
              className="mt-1"
              defaultValue={initialValues.numberFormat}
              name="numberFormat"
            >
              <option value="1,000,000">1,000,000</option>
              <option value="1.000.000">1.000.000</option>
            </Select>
          </label>

          <label>
            <span className="text-sm font-medium text-slate-700">
              Default dashboard period
            </span>
            <Select
              className="mt-1"
              defaultValue={initialValues.defaultDashboardPeriod}
              name="defaultDashboardPeriod"
            >
              <option value="Week">Week</option>
              <option value="Month">Month</option>
              <option value="Year">Year</option>
            </Select>
          </label>
        </div>
      </Card>

      <Card title="Profile Info">
        <div className="grid gap-4 md:grid-cols-2">
          <label>
            <span className="text-sm font-medium text-slate-700">Name</span>
            <Input className="mt-1" defaultValue={initialValues.name} name="name" required />
          </label>

          <label>
            <span className="text-sm font-medium text-slate-700">Email</span>
            <Input
              className="mt-1 bg-slate-50 text-slate-500"
              readOnly
              value={initialValues.email}
            />
          </label>
        </div>
      </Card>

      <Card title="Change Password">
        <div className="grid gap-4 md:grid-cols-3">
          <label>
            <span className="text-sm font-medium text-slate-700">
              Current password
            </span>
            <Input
              autoComplete="current-password"
              className="mt-1"
              name="currentPassword"
              type="password"
            />
          </label>

          <label>
            <span className="text-sm font-medium text-slate-700">
              New password
            </span>
            <Input
              autoComplete="new-password"
              className="mt-1"
              minLength={8}
              name="newPassword"
              type="password"
            />
          </label>

          <label>
            <span className="text-sm font-medium text-slate-700">
              Confirm password
            </span>
            <Input
              autoComplete="new-password"
              className="mt-1"
              minLength={8}
              name="confirmPassword"
              type="password"
            />
          </label>
        </div>
      </Card>

      {state.error ? (
        <p className="rounded-md border border-expense/20 bg-expense/10 px-3 py-2 text-sm text-expense">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="rounded-md border border-income/20 bg-income/10 px-3 py-2 text-sm text-income">
          {state.success}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit">Save Settings</Button>
      </div>
    </form>
  );
}
