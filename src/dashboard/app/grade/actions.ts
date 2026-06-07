'use server';

import {
  gradeManualProperty,
  type ManualGradeInput,
  type ManualPropertyType,
} from '@/lib/grade-manual';
import type { GradeFormState } from './state';

const PROPERTY_TYPES: ManualPropertyType[] = ['SFH', 'Duplex', 'Triplex', 'Quad'];

/** Required positive number from a form field. */
function posNum(value: FormDataEntryValue | null): number | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Grade a manually-entered property and return the result for inline display. */
export async function gradeManualAction(
  _prev: GradeFormState,
  formData: FormData,
): Promise<GradeFormState> {
  const values: Record<string, string> = {};
  for (const [k, v] of formData.entries()) values[k] = String(v);

  const zip = String(formData.get('zip') ?? '').trim();
  const price = posNum(formData.get('price'));
  const sqft = posNum(formData.get('sqft'));
  const beds = posNum(formData.get('beds'));
  const baths = posNum(formData.get('baths'));
  const hoa = posNum(formData.get('hoa')) ?? 0;
  const rawType = String(formData.get('property_type') ?? '');
  const propertyType = PROPERTY_TYPES.includes(rawType as ManualPropertyType)
    ? (rawType as ManualPropertyType)
    : 'SFH';
  const address = String(formData.get('address') ?? '').trim();

  const missing: string[] = [];
  if (!/^\d{5}$/.test(zip)) missing.push('a 5-digit zip code');
  if (price == null || price <= 0) missing.push('a list price');
  if (sqft == null || sqft <= 0) missing.push('square footage');
  if (beds == null) missing.push('bedrooms');
  if (baths == null) missing.push('bathrooms');

  if (missing.length > 0) {
    return { result: null, error: `Please enter ${missing.join(', ')}.`, values };
  }

  const input: ManualGradeInput = {
    address,
    zip,
    price: price!,
    sqft: sqft!,
    beds: beds!,
    baths: baths!,
    propertyType,
    hoaMonthly: hoa,
  };

  const result = gradeManualProperty(input);
  if (!result.ok) {
    return { result: null, error: result.error, values };
  }
  return { result, error: null, values };
}
