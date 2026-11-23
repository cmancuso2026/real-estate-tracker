// Hand-off from the Upload page to a property page: the PDF you dropped on
// Upload → Property documents waits here (in memory, during the client-side
// navigation) until that property's page picks it up and opens its usual
// review screen. Nothing is stored anywhere else.

export type PropertyDocType = 'lease' | 'insurance' | 'escrow' | 'mortgage';

export const DOC_TYPES: { type: PropertyDocType; label: string; tab: string; hint: string }[] = [
  { type: 'lease', label: 'Lease', tab: 'leases', hint: 'Tenant, dates, rent, deposit, late fees' },
  { type: 'insurance', label: 'Insurance policy', tab: 'insurance', hint: 'Carrier, coverage, premium, dates' },
  { type: 'escrow', label: 'Escrow statement', tab: 'escrow', hint: 'Taxes, insurance, shortage, new escrow payment' },
  { type: 'mortgage', label: 'Mortgage statement', tab: 'escrow', hint: 'Principal, interest, taxes, insurance (PITI)' },
];

interface Pending {
  propertyId: number;
  type: PropertyDocType;
  file: File;
}

let pending: Pending | null = null;

export function setPendingDoc(p: Pending) {
  pending = p;
}

/** The waiting document for this property, once (it is cleared). */
export function takePendingDoc(propertyId: number): Pending | null {
  if (!pending || pending.propertyId !== propertyId) return null;
  const p = pending;
  pending = null;
  return p;
}
