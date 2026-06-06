'use client';

import { useFormStatus } from 'react-dom';
import type { InvestorProfile } from '@/lib/profile';
import { PROFILE_PROPERTY_TYPES } from '@/lib/format';
import { saveProfileAction } from '@/app/settings/actions';

const INPUT =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm tabular ' +
  'focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 ' +
  'dark:border-gray-700 dark:bg-gray-900';

const TYPE_HINTS: Record<string, string> = {
  SFH: 'Single-family',
  Duplex: '2 units',
  Triplex: '3 units',
  Quad: '4 units',
};

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">{hint}</span>}
    </label>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
    >
      {pending ? 'Saving…' : 'Save profile'}
    </button>
  );
}

export function ProfileForm({ profile }: { profile: InvestorProfile }) {
  return (
    <form action={saveProfileAction} className="max-w-xl space-y-6">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Min purchase price" hint="Floor on list price. Blank = no floor.">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">
              $
            </span>
            <input
              name="min_purchase_price"
              type="number"
              min={0}
              step={1000}
              inputMode="numeric"
              placeholder="e.g. 150000"
              defaultValue={profile.minPurchasePrice ?? ''}
              className={`${INPUT} pl-7`}
            />
          </div>
        </Field>

        <Field label="Max purchase price" hint="Cap on list price. Blank = no cap.">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">
              $
            </span>
            <input
              name="max_purchase_price"
              type="number"
              min={0}
              step={1000}
              inputMode="numeric"
              placeholder="e.g. 500000"
              defaultValue={profile.maxPurchasePrice ?? ''}
              className={`${INPUT} pl-7`}
            />
          </div>
        </Field>

        <Field label="Available cash" hint="For down payment + closing costs.">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">
              $
            </span>
            <input
              name="available_cash"
              type="number"
              min={0}
              step={1000}
              inputMode="numeric"
              placeholder="e.g. 150000"
              defaultValue={profile.availableCash ?? ''}
              className={`${INPUT} pl-7`}
            />
          </div>
        </Field>

        <Field label="Minimum beds" hint="Blank = any.">
          <input
            name="min_beds"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            placeholder="e.g. 3"
            defaultValue={profile.minBeds ?? ''}
            className={INPUT}
          />
        </Field>

        <Field label="Min cash-on-cash return" hint="Annual %, before tax.">
          <div className="relative">
            <input
              name="min_coc_return"
              type="number"
              min={0}
              step={0.1}
              inputMode="decimal"
              placeholder="e.g. 6"
              defaultValue={profile.minCocReturn ?? ''}
              className={`${INPUT} pr-8`}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">
              %
            </span>
          </div>
        </Field>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Target property types</legend>
        <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
          Leave all unchecked to include any type.
        </p>
        <div className="flex flex-wrap gap-2">
          {PROFILE_PROPERTY_TYPES.map((t) => (
            <label
              key={t}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
            >
              <input
                type="checkbox"
                name="property_types"
                value={t}
                defaultChecked={profile.propertyTypes.includes(t)}
                className="h-4 w-4 accent-blue-600"
              />
              <span className="font-medium">{t}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">{TYPE_HINTS[t]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex items-center gap-3 border-t border-gray-100 pt-4 dark:border-gray-800">
        <SubmitButton />
        <span className="text-xs text-gray-500 dark:text-gray-400">
          Applies to the dashboard and listings immediately after saving.
        </span>
      </div>
    </form>
  );
}
