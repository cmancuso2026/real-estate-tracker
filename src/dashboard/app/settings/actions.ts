'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { saveProfile, type InvestorProfile } from '@/lib/profile';
import { PROFILE_PROPERTY_TYPES, type ProfilePropertyType } from '@/lib/format';

/** Parse a form number field: blank/invalid -> null, negatives clamped out. */
function num(value: FormDataEntryValue | null): number | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Persist the investor profile from the settings form, then refresh views. */
export async function saveProfileAction(formData: FormData): Promise<void> {
  const allowed = new Set<string>(PROFILE_PROPERTY_TYPES);
  const propertyTypes = formData
    .getAll('property_types')
    .map(String)
    .filter((t): t is ProfilePropertyType => allowed.has(t));

  const profile: InvestorProfile = {
    maxPurchasePrice: num(formData.get('max_purchase_price')),
    availableCash: num(formData.get('available_cash')),
    propertyTypes,
    minBeds: num(formData.get('min_beds')),
    minCocReturn: num(formData.get('min_coc_return')),
  };

  saveProfile(profile);

  // The profile changes what both pages display, so revalidate both.
  revalidatePath('/');
  revalidatePath('/settings');
  redirect('/settings?saved=1');
}
