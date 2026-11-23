// Matching a bank deposit to a tenant, unit and rent month.
//
// These rules come unchanged from the old Import Rent page
// (src/dashboard/app/api/v2/rent/import/route.ts), which parsed BofA CSVs:
//   - the tenant's name is read from "Zelle payment from NAME Conf# …"
//   - names are scored against active tenants (100 exact … 50 first name);
//     below 50 is no match, 85+ is high confidence
//   - Miami-Dade PHCD deposits are Section 8 payments (no name to read)
//   - a payment in the last 5 days of a month is rent for the next month
//   - it is late when paid more than the lease's grace days (default 5) after
//     the 1st; a late fee is "included" when amount ≈ rent + fee (±$5)
// Dates are handled as plain YYYY-MM-DD strings so the server's timezone can't
// shift a day.

/** "Zelle payment from SAMUEL PEREZ MARTINEZ Conf# xe14ougde" → "SAMUEL PEREZ MARTINEZ". */
export function extractZelleName(description) {
  const match = String(description).match(/zelle\s+payment\s+from\s+(.+?)(?:\s+conf#|\s+confirmation|\s*$)/i);
  if (match?.[1]) return match[1].trim();
  const match2 = String(description).match(/from\s+([A-Z][A-Z\s]+?)(?:\s+Conf#|\s*$)/i);
  if (match2?.[1]) return match2[1].trim();
  return null;
}

export const isZelle = (description) => /zelle/i.test(String(description));

export const isHousingAuthority = (description) =>
  /miami.?dade.*phcd|phcd.*miami.?dade|miami.?dade.*cnty.*des/i.test(String(description));

export function normalizeName(s) {
  return String(s).toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

/** 0–100 score of how well a name read from a deposit matches a tenant. */
export function matchScore(extractedName, tenant) {
  if (!extractedName) return 0;
  const name = normalizeName(extractedName);
  const full = normalizeName(`${tenant.first_name} ${tenant.last_name}`);
  const last = normalizeName(tenant.last_name);
  const first = normalizeName(tenant.first_name);

  if (name === full) return 100;
  if (name.includes(full) || full.includes(name)) return 95;
  const nameWords = name.split(' ');
  const fullWords = full.split(' ');
  const overlap = nameWords.filter((w) => w.length > 2 && fullWords.includes(w)).length;
  if (overlap >= 2) return 85;
  if (name.includes(last) && last.length > 2) return 70;
  if (overlap === 1 && first.length > 3 && name.includes(first)) return 50;
  return 0;
}

/** 'MM/DD/YYYY' or 'YYYY-MM-DD…' → [y, m, d], or null. */
export function ymdParts(raw) {
  const s = String(raw ?? '').trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return [Number(m[3]), Number(m[1]), Number(m[2])];
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

const pad = (n) => String(n).padStart(2, '0');
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** 'YYYY-MM-DD' for any accepted date format ('' when unparseable). */
export function isoOf(raw) {
  const p = ymdParts(raw);
  return p ? `${p[0]}-${pad(p[1])}-${pad(p[2])}` : '';
}

/** Rent month for a payment: the last 5 days of a month count toward the next. */
export function assignMonth(rawDate) {
  const p = ymdParts(rawDate);
  if (!p) return { assignedMonth: '', dueDate: '', isEarly: false };
  const [year, month, day] = p;
  const isEarly = day >= daysIn(year, month) - 4;
  let am = month;
  let ay = year;
  if (isEarly) {
    am += 1;
    if (am > 12) {
      am = 1;
      ay += 1;
    }
  }
  const assignedMonth = `${ay}-${pad(am)}`;
  return { assignedMonth, dueDate: `${assignedMonth}-01`, isEarly };
}

/** Paid more than graceDays after the due date. */
export function checkLate(rawDate, dueDate, graceDays) {
  const paid = ymdParts(rawDate);
  const due = ymdParts(dueDate);
  if (!paid || !due) return false;
  const ms = Date.UTC(paid[0], paid[1] - 1, paid[2]) - Date.UTC(due[0], due[1] - 1, due[2]);
  return Math.ceil(ms / 86400000) > graceDays;
}

/**
 * Best tenant for a deposit by name, among `tenants` (rows with first_name,
 * last_name). Returns { tenant, score, name } — tenant null below 50.
 */
export function bestTenantByName(description, tenants) {
  const name = extractZelleName(description);
  let tenant = null;
  let score = 0;
  for (const t of tenants) {
    const s = matchScore(name, t);
    if (s > score) {
      score = s;
      tenant = t;
    }
  }
  return { tenant: score >= 50 ? tenant : null, score, name };
}

/**
 * Late flags for a payment against a lease, exactly as the import page set them.
 * lease: { rent_amount, late_fee_amount, late_fee_grace_days } (any may be null).
 */
export function paymentFlags(rawDate, amount, lease) {
  const { assignedMonth, dueDate, isEarly } = assignMonth(rawDate);
  const graceDays = lease?.late_fee_grace_days ?? 5;
  const isLate = !isEarly && checkLate(rawDate, dueDate, graceDays);
  const rentAmount = lease?.rent_amount ?? 0;
  const lateFeeAmt = lease?.late_fee_amount ?? 0;
  const lateFeeIncluded = isLate && lateFeeAmt > 0 && Math.abs(amount - (rentAmount + lateFeeAmt)) <= 5;
  const lateFeeApplicable = isLate && !lateFeeIncluded;
  const notes = [];
  if (isEarly) notes.push(`Paid early — assigned to ${assignedMonth}`);
  if (isLate && lateFeeIncluded) notes.push(`Late fee of $${lateFeeAmt} included in payment`);
  else if (isLate) notes.push(`Paid late — grace period ${graceDays} days`);
  return { assignedMonth, dueDate, isEarly, isLate, lateFeeIncluded, lateFeeApplicable, note: notes.join(' · ') };
}
