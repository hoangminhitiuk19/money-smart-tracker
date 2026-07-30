"use client";

import {
  CardNetwork,
  FeeFrequency,
  MoneySourceType,
  WaiverPeriod
} from "@prisma/client";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  createMoneySource,
  updateMoneySource
} from "@/lib/actions/money-sources";
import type { MoneySourceInput } from "@/lib/validation/money-source";

export type MoneySourceFormInitialValues = MoneySourceInput & {
  id: string;
};

type MoneySourceFormProps = {
  initialValues?: MoneySourceFormInitialValues;
};

const sourceTypes = Object.values(MoneySourceType);
const cardNetworks = Object.values(CardNetwork);
const feeFrequencies = Object.values(FeeFrequency);
const waiverPeriods = Object.values(WaiverPeriod);

const typeLabels: Record<MoneySourceType, string> = {
  CASH: "Cash",
  BANK_ACCOUNT: "Bank Account",
  CREDIT_CARD: "Credit Card",
  DEBIT_CARD: "Debit Card",
  E_WALLET: "E-Wallet",
  INVESTMENT: "Investment",
  OTHER: "Other"
};

function enumLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function fieldValue(value: unknown, fallback = "") {
  return value === undefined || value === null ? fallback : String(value);
}

function nullableField(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value || null;
}

function CheckboxField({
  checked,
  description,
  label,
  onChange
}: {
  checked: boolean;
  description?: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
      <input
        checked={checked}
        className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-xs leading-5 text-slate-500">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}

function GroupHeading({
  description,
  title
}: {
  description: string;
  title: string;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
    </div>
  );
}

export function MoneySourceForm({
  initialValues
}: MoneySourceFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<MoneySourceType>(
    initialValues?.type ?? MoneySourceType.BANK_ACCOUNT
  );
  const [isActive, setIsActive] = useState(initialValues?.isActive ?? true);
  const [hasAnnualFee, setHasAnnualFee] = useState(
    initialValues?.hasAnnualFee ?? false
  );
  const [firstYearFeeWaived, setFirstYearFeeWaived] = useState(
    initialValues?.firstYearFeeWaived ?? false
  );
  const [annualFeeWaiverEnabled, setAnnualFeeWaiverEnabled] = useState(
    initialValues?.annualFeeWaiverEnabled ?? false
  );
  const isEdit = Boolean(initialValues?.id);
  const isCreditCard = type === MoneySourceType.CREDIT_CARD;

  function buildPayload(formData: FormData): MoneySourceInput {
    const basePayload: MoneySourceInput = {
      name: String(formData.get("name") ?? ""),
      type,
      providerName: nullableField(formData, "providerName"),
      displayIdentifier: nullableField(formData, "displayIdentifier"),
      currency: String(formData.get("currency") || "VND"),
      openingBalance: String(formData.get("openingBalance") || "0"),
      description: nullableField(formData, "description"),
      isActive
    };

    if (!isCreditCard) {
      return basePayload;
    }

    return {
      ...basePayload,
      cardLastFourDigits: nullableField(formData, "cardLastFourDigits"),
      cardNetwork:
        (nullableField(formData, "cardNetwork") as CardNetwork | null),
      openedDate: nullableField(formData, "openedDate"),
      creditLimit: nullableField(formData, "creditLimit"),
      initialOutstandingDebt:
        String(formData.get("initialOutstandingDebt") || "0"),
      initialCardCredit: String(formData.get("initialCardCredit") || "0"),
      billingCycleDay: nullableField(formData, "billingCycleDay"),
      paymentDueDay: nullableField(formData, "paymentDueDay"),
      hasAnnualFee,
      annualFeeAmount: hasAnnualFee
        ? nullableField(formData, "annualFeeAmount")
        : null,
      annualFeeCurrency: String(formData.get("annualFeeCurrency") || "VND"),
      annualFeeChargeDate: hasAnnualFee
        ? nullableField(formData, "annualFeeChargeDate")
        : null,
      annualFeeFrequency: hasAnnualFee
        ? (nullableField(
            formData,
            "annualFeeFrequency"
          ) as FeeFrequency | null)
        : null,
      firstYearFeeWaived: hasAnnualFee ? firstYearFeeWaived : false,
      freeYearsCount: hasAnnualFee
        ? nullableField(formData, "freeYearsCount")
        : null,
      feeWaivedUntilDate: hasAnnualFee
        ? nullableField(formData, "feeWaivedUntilDate")
        : null,
      annualFeeWaiverEnabled,
      annualFeeWaiverSpendTarget: annualFeeWaiverEnabled
        ? nullableField(formData, "annualFeeWaiverSpendTarget")
        : null,
      annualFeeWaiverPeriod: annualFeeWaiverEnabled
        ? (nullableField(
            formData,
            "annualFeeWaiverPeriod"
          ) as WaiverPeriod | null)
        : null,
      waiverPeriodStartDate: annualFeeWaiverEnabled
        ? nullableField(formData, "waiverPeriodStartDate")
        : null,
      waiverPeriodEndDate: annualFeeWaiverEnabled
        ? nullableField(formData, "waiverPeriodEndDate")
        : null,
      annualFeeWaiverNote: annualFeeWaiverEnabled
        ? nullableField(formData, "annualFeeWaiverNote")
        : null
    };
  }

  function handleSubmit(formData: FormData) {
    setError(null);
    const payload = buildPayload(formData);

    startTransition(async () => {
      const result =
        isEdit && initialValues
          ? await updateMoneySource(initialValues.id, payload)
          : await createMoneySource(payload);

      if (!result.ok) {
        setError(result.error ?? "Unable to save this account.");
        return;
      }

      if (!isEdit) {
        formRef.current?.reset();
        setType(MoneySourceType.BANK_ACCOUNT);
        setIsActive(true);
        setHasAnnualFee(false);
        setFirstYearFeeWaived(false);
        setAnnualFeeWaiverEnabled(false);
      }

      router.refresh();
    });
  }

  return (
    <Card title={isEdit ? "Edit Account" : "Add Account"}>
      <form
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit(new FormData(event.currentTarget));
        }}
        ref={formRef}
      >
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <label className="lg:col-span-2">
            <span className="text-sm font-medium text-slate-700">
              Account name
            </span>
            <Input
              className="mt-1"
              defaultValue={fieldValue(initialValues?.name)}
              name="name"
              required
            />
          </label>

          <label>
            <span className="text-sm font-medium text-slate-700">Type</span>
            <Select
              className="mt-1"
              onChange={(event) => {
                setType(event.target.value as MoneySourceType);
              }}
              value={type}
            >
              {sourceTypes.map((sourceType) => (
                <option key={sourceType} value={sourceType}>
                  {typeLabels[sourceType]}
                </option>
              ))}
            </Select>
          </label>

          <label>
            <span className="text-sm font-medium text-slate-700">Provider</span>
            <Input
              className="mt-1"
              defaultValue={fieldValue(initialValues?.providerName)}
              name="providerName"
              placeholder="Bank or wallet provider"
            />
          </label>

          <label>
            <span className="text-sm font-medium text-slate-700">
              Display identifier
            </span>
            <Input
              className="mt-1"
              defaultValue={fieldValue(initialValues?.displayIdentifier)}
              name="displayIdentifier"
              placeholder="For example, ending 1234"
            />
          </label>

          <label>
            <span className="text-sm font-medium text-slate-700">Currency</span>
            <Input
              className="mt-1 uppercase"
              defaultValue={fieldValue(initialValues?.currency, "VND")}
              name="currency"
              required
            />
          </label>

          <label>
            <span className="text-sm font-medium text-slate-700">
              Opening balance
            </span>
            <Input
              className="mt-1"
              defaultValue={fieldValue(initialValues?.openingBalance, "0")}
              name="openingBalance"
              step="0.01"
              type="number"
            />
          </label>

          <label className="md:col-span-2">
            <span className="text-sm font-medium text-slate-700">
              Description
            </span>
            <Input
              className="mt-1"
              defaultValue={fieldValue(initialValues?.description)}
              name="description"
              placeholder="Optional notes"
            />
          </label>

          <div>
            <CheckboxField
              checked={isActive}
              description="Inactive accounts stay in history but are marked as unavailable."
              label="Account is active"
              onChange={setIsActive}
            />
          </div>
        </div>

        {isCreditCard ? (
          <>
            <section className="space-y-4 border-t border-slate-200 pt-5">
              <GroupHeading
                description="Use statement details only. Never enter a full card number, PIN, CVV, OTP, or banking credentials."
                title="Card details"
              />
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <label>
                  <span className="text-sm font-medium text-slate-700">
                    Card digits
                  </span>
                  <Input
                    className="mt-1"
                    defaultValue={fieldValue(
                      initialValues?.cardLastFourDigits
                    )}
                    inputMode="numeric"
                    maxLength={6}
                    minLength={2}
                    name="cardLastFourDigits"
                    pattern="[0-9]{2,6}"
                    placeholder="Last 2–6 digits"
                  />
                </label>

                <label>
                  <span className="text-sm font-medium text-slate-700">
                    Card network
                  </span>
                  <Select
                    className="mt-1"
                    defaultValue={fieldValue(initialValues?.cardNetwork)}
                    name="cardNetwork"
                  >
                    <option value="">Not specified</option>
                    {cardNetworks.map((network) => (
                      <option key={network} value={network}>
                        {enumLabel(network)}
                      </option>
                    ))}
                  </Select>
                </label>

                <label>
                  <span className="text-sm font-medium text-slate-700">
                    Opened date
                  </span>
                  <Input
                    className="mt-1"
                    defaultValue={fieldValue(initialValues?.openedDate)}
                    name="openedDate"
                    type="date"
                  />
                </label>

                <label>
                  <span className="text-sm font-medium text-slate-700">
                    Credit limit
                  </span>
                  <Input
                    className="mt-1"
                    defaultValue={fieldValue(initialValues?.creditLimit)}
                    min="0"
                    name="creditLimit"
                    step="0.01"
                    type="number"
                  />
                </label>

                <label>
                  <span className="text-sm font-medium text-slate-700">
                    Initial outstanding debt
                  </span>
                  <Input
                    className="mt-1"
                    defaultValue={fieldValue(
                      initialValues?.initialOutstandingDebt,
                      "0"
                    )}
                    min="0"
                    name="initialOutstandingDebt"
                    step="0.01"
                    type="number"
                  />
                </label>

                <label>
                  <span className="text-sm font-medium text-slate-700">
                    Initial card credit
                  </span>
                  <Input
                    className="mt-1"
                    defaultValue={fieldValue(
                      initialValues?.initialCardCredit,
                      "0"
                    )}
                    min="0"
                    name="initialCardCredit"
                    step="0.01"
                    type="number"
                  />
                </label>

                <label>
                  <span className="text-sm font-medium text-slate-700">
                    Billing cycle day
                  </span>
                  <Input
                    className="mt-1"
                    defaultValue={fieldValue(initialValues?.billingCycleDay)}
                    max="31"
                    min="1"
                    name="billingCycleDay"
                    step="1"
                    type="number"
                  />
                </label>

                <label>
                  <span className="text-sm font-medium text-slate-700">
                    Payment due day
                  </span>
                  <Input
                    className="mt-1"
                    defaultValue={fieldValue(initialValues?.paymentDueDay)}
                    max="31"
                    min="1"
                    name="paymentDueDay"
                    step="1"
                    type="number"
                  />
                </label>
              </div>
            </section>

            <section className="space-y-4 border-t border-slate-200 pt-5">
              <GroupHeading
                description="Record the fee shown by your provider and the next date you expect it to be charged."
                title="Annual fee"
              />
              <CheckboxField
                checked={hasAnnualFee}
                description="Turn this on to track fee timing and any confirmed free years."
                label="This card has an annual fee"
                onChange={setHasAnnualFee}
              />

              {hasAnnualFee ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <label>
                    <span className="text-sm font-medium text-slate-700">
                      Fee amount
                    </span>
                    <Input
                      className="mt-1"
                      defaultValue={fieldValue(initialValues?.annualFeeAmount)}
                      min="0"
                      name="annualFeeAmount"
                      required
                      step="0.01"
                      type="number"
                    />
                  </label>

                  <label>
                    <span className="text-sm font-medium text-slate-700">
                      Fee currency
                    </span>
                    <Input
                      className="mt-1 uppercase"
                      defaultValue={fieldValue(
                        initialValues?.annualFeeCurrency,
                        "VND"
                      )}
                      name="annualFeeCurrency"
                      required
                    />
                  </label>

                  <label>
                    <span className="text-sm font-medium text-slate-700">
                      Frequency
                    </span>
                    <Select
                      className="mt-1"
                      defaultValue={fieldValue(
                        initialValues?.annualFeeFrequency,
                        FeeFrequency.YEARLY
                      )}
                      name="annualFeeFrequency"
                      required
                    >
                      {feeFrequencies.map((frequency) => (
                        <option key={frequency} value={frequency}>
                          {enumLabel(frequency)}
                        </option>
                      ))}
                    </Select>
                  </label>

                  <label>
                    <span className="text-sm font-medium text-slate-700">
                      Next charge date
                    </span>
                    <Input
                      className="mt-1"
                      defaultValue={fieldValue(
                        initialValues?.annualFeeChargeDate
                      )}
                      name="annualFeeChargeDate"
                      required
                      type="date"
                    />
                  </label>

                  <label>
                    <span className="text-sm font-medium text-slate-700">
                      Free years
                    </span>
                    <Input
                      className="mt-1"
                      defaultValue={fieldValue(
                        initialValues?.freeYearsCount
                      )}
                      max="100"
                      min="0"
                      name="freeYearsCount"
                      step="1"
                      type="number"
                    />
                  </label>

                  <label>
                    <span className="text-sm font-medium text-slate-700">
                      Fee waived until
                    </span>
                    <Input
                      className="mt-1"
                      defaultValue={fieldValue(
                        initialValues?.feeWaivedUntilDate
                      )}
                      name="feeWaivedUntilDate"
                      type="date"
                    />
                  </label>

                  <div className="md:col-span-2 lg:col-span-3">
                    <CheckboxField
                      checked={firstYearFeeWaived}
                      label="First-year fee is waived"
                      onChange={setFirstYearFeeWaived}
                    />
                  </div>
                </div>
              ) : null}
            </section>

            <section className="space-y-4 border-t border-slate-200 pt-5">
              <GroupHeading
                description="Track progress toward the spending target your provider uses for a fee waiver."
                title="Waiver tracking"
              />
              <CheckboxField
                checked={annualFeeWaiverEnabled}
                description="Tracked totals are estimates. Verify eligibility and exclusions with your provider."
                label="Track a fee-waiver spending target"
                onChange={setAnnualFeeWaiverEnabled}
              />

              {annualFeeWaiverEnabled ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <label>
                    <span className="text-sm font-medium text-slate-700">
                      Spending target
                    </span>
                    <Input
                      className="mt-1"
                      defaultValue={fieldValue(
                        initialValues?.annualFeeWaiverSpendTarget
                      )}
                      min="0.01"
                      name="annualFeeWaiverSpendTarget"
                      required
                      step="0.01"
                      type="number"
                    />
                  </label>

                  <label>
                    <span className="text-sm font-medium text-slate-700">
                      Waiver period
                    </span>
                    <Select
                      className="mt-1"
                      defaultValue={fieldValue(
                        initialValues?.annualFeeWaiverPeriod,
                        WaiverPeriod.YEARLY
                      )}
                      name="annualFeeWaiverPeriod"
                      required
                    >
                      {waiverPeriods.map((period) => (
                        <option key={period} value={period}>
                          {enumLabel(period)}
                        </option>
                      ))}
                    </Select>
                  </label>

                  <label>
                    <span className="text-sm font-medium text-slate-700">
                      Period start
                    </span>
                    <Input
                      className="mt-1"
                      defaultValue={fieldValue(
                        initialValues?.waiverPeriodStartDate
                      )}
                      name="waiverPeriodStartDate"
                      required
                      type="date"
                    />
                  </label>

                  <label>
                    <span className="text-sm font-medium text-slate-700">
                      Period end
                    </span>
                    <Input
                      className="mt-1"
                      defaultValue={fieldValue(
                        initialValues?.waiverPeriodEndDate
                      )}
                      name="waiverPeriodEndDate"
                      required
                      type="date"
                    />
                  </label>

                  <label className="md:col-span-2">
                    <span className="text-sm font-medium text-slate-700">
                      Waiver rules note
                    </span>
                    <Input
                      className="mt-1"
                      defaultValue={fieldValue(
                        initialValues?.annualFeeWaiverNote
                      )}
                      name="annualFeeWaiverNote"
                      placeholder="For example, excluded transaction types"
                    />
                  </label>
                </div>
              ) : null}
            </section>
          </>
        ) : null}

        {error ? (
          <p className="rounded-md border border-expense/20 bg-expense/10 px-3 py-2 text-sm text-expense">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end">
          <Button
            className="w-full sm:w-auto"
            disabled={isPending}
            loading={isPending}
            type="submit"
          >
            {isEdit ? "Save Changes" : "Add Account"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
