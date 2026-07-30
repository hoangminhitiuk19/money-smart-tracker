import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SettingsForm } from "@/components/settings-form";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useActionState: vi.fn(() => [{}, vi.fn(), false])
  };
});

vi.mock("@/lib/actions/settings", () => ({
  updateUserSettings: vi.fn()
}));

const initialValues = {
  dateFormat: "DD/MM/YYYY",
  defaultCurrency: "VND",
  defaultDashboardPeriod: "Month",
  email: "read-only@example.com",
  name: "Settings User",
  numberFormat: "1,000,000"
};

describe("settings form feedback and account identity", () => {
  it("keeps email read-only and exposes persistent save feedback regions", () => {
    const markup = renderToStaticMarkup(
      <SettingsForm initialValues={initialValues} />
    );

    expect(markup).toContain('value="read-only@example.com"');
    expect(markup).toContain("readOnly");
    expect(markup).not.toContain('name="email"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('aria-live="assertive"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain(">Save Settings</button>");
  });
});
