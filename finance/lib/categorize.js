// Auto-categorization: merchant string -> { category, group }.
//
// All matching lives here so new merchant rules can be added without touching
// parsers or routes (spec §Notes). Rules are checked top-to-bottom; the FIRST
// match wins, so more specific patterns must come before broader ones
// (e.g. Amex "UBER EATS" before "UBER").
//
// The rules were validated against the real April-2026 transactions embedded in
// the original dashboard. Two deviations from the spec's prose, resolved in
// favour of that ground-truth data:
//   * BoA "NEAT N TIDY" -> Other/Uncategorized (spec's own note says the
//     cleaning service should be flagged for review), while "RAYS BARBER"
//     stays Living/Healthcare.
//   * Amex also matches "WHOLE FOODS" (with a space) in addition to the spec's
//     "WHOLEFDS", since real statements use both spellings.
const { groupFor } = require('./taxonomy');

// True if `haystack` contains any of the given needles (all upper-cased).
function has(haystack, ...needles) {
  return needles.some((n) => haystack.includes(n));
}

// ── Bank of America ────────────────────────────────────────────────────────
function bankofamericaRules(desc, raw) {
  if (has(desc, 'CAPITAL ONE')) return 'Capital One';
  if (has(desc, 'COMCAST', 'XFINITY')) return 'Wifi';
  if (has(desc, 'STARBUCKS', 'DOORDASH', 'UBER *EATS')) return 'Eating Out';
  if (has(desc, 'FAMILY DOLLAR')) return 'Family Dollar';
  if (has(desc, 'HOME DEPOT')) return 'Home Depot';
  if (has(desc, 'WALGREENS', 'UM MY CHART', 'LAI FAN CHI')) return 'Healthcare';
  if (has(desc, 'NORDSTROM', 'MACYS', 'SEW ON SET')) return 'Shopping';
  if (has(desc, 'TRULY NOLEN')) return 'Home Security';
  if (has(desc, 'EXXON', '7-ELEVEN')) return 'Gas';
  if (has(desc, 'JMH PARKING', 'VALET')) return 'Parking';
  if (has(desc, 'RAYS BARBER')) return 'Healthcare';
  if (has(desc, 'NEAT N TIDY')) return 'Uncategorized'; // cleaning service — flag for review
  if (has(desc, 'BARK.CO')) return 'Roman';
  if (has(desc, 'FLVITALS', 'NEWBORN')) return 'Baby Gear';
  if (has(desc, 'SUNCO LIGHTING')) return 'Shopping';
  if (has(desc, 'IL MERCATO', 'CANTEEN')) return 'Eating Out';
  if (has(desc, 'MAX APPLIANCE')) return 'Repairs';
  if (has(raw, 'DINING')) return 'Eating Out';
  return 'Uncategorized';
}

// ── Amex (Gold + Blue Cash) ─────────────────────────────────────────────────
function amexRules(desc) {
  if (has(desc, 'LAWNSTARTER')) return 'Lawn Care';
  if (has(desc, 'DIAMOND PLUMBING', 'OASIS PLUMBING')) return 'Repairs';
  if (has(desc, 'HOME DEPOT')) return 'Home Depot';
  if (has(desc, 'UBER EATS')) return 'Eating Out';
  if (has(desc, 'UBER')) return 'Lyft'; // any other Uber = ride
  if (has(desc, 'PUBLIX', 'WILD FORK', 'WHOLEFDS', 'WHOLE FOODS', 'BAGEL BAR')) return 'Groceries';
  if (has(desc, 'MATTERPORT')) return 'Matterport';
  if (has(desc, 'ADTSECURITY', 'ADT')) return 'Home Security';
  if (has(desc, 'SUBWAY', 'POPEYES', 'MCDONALD')) return 'Eating Out';
  if (has(desc, 'PANERA', 'STARBUCKS')) return 'Eating Out';
  if (has(desc, 'SUNPASS')) return 'Sunpass';
  if (has(desc, 'JETBLUE')) return 'Flights';
  if (has(desc, 'OPENAI')) return 'Entertainment';
  if (has(desc, 'APPLE.COM')) return 'Phone';
  if (has(desc, 'TRULY NOLEN')) return 'Home Security';
  if (has(desc, 'HILL HOUSE')) return 'Shopping';
  if (has(desc, 'AMAZON', 'AMZN')) return 'Amazon';
  if (has(desc, 'MARATHON', 'EXXONMOBIL', '7-11')) return 'Gas';
  if (has(desc, 'FPL', 'FL POWER')) return 'Electric';
  if (has(desc, 'QUEST DIAGNOSTICS')) return 'Healthcare';
  if (has(desc, 'TARGET')) return 'Shopping';
  if (has(desc, 'PHOTO ENFORCEMENT')) return 'Other';
  return 'Uncategorized';
}

// ── SoFi ────────────────────────────────────────────────────────────────────
// `raw` here carries the SoFi "Type" column (Direct Deposit, Withdrawal, …).
function sofiRules(desc, raw) {
  if (has(desc, 'FRANCHISE WORLD') && has(raw, 'DEPOSIT')) return 'Paycheck';
  if (has(desc, 'CAPITAL ONE')) return 'Capital One';
  if (has(desc, 'FREEDOM')) return '20 PITI';
  if (has(desc, 'FIGURE LENDING')) return 'Uncategorized';
  if (has(desc, 'WF HOME MTG')) return 'Other';
  if (has(desc, 'WF PL CC')) return 'Other';
  if (has(desc, 'INTEREST')) return 'SoFi';
  return 'Uncategorized';
}

// ── Capital One ───────────────────────────────────────────────────────────
// Capital One exports a reliable bank Category column (`raw` here), so we map
// that into the taxonomy, with a few merchant overrides that beat the generic
// category. Card payments ('Payment/Credit') are dropped in the parser.
const CAPONE_CATEGORY_MAP = {
  'GAS/AUTOMOTIVE': 'Gas',
  DINING: 'Eating Out',
  MERCHANDISE: 'Shopping',
  'HEALTH CARE': 'Healthcare',
  ENTERTAINMENT: 'Entertainment',
  AIRFARE: 'Flights',
  LODGING: 'Hotel',
  'PROFESSIONAL SERVICES': 'Repairs',
  'PHONE/CABLE': 'Phone',
};

function capitalOneRules(desc, raw) {
  // Merchant overrides (more specific than the bank category).
  if (has(desc, 'LAI FAN CHI')) return 'Healthcare'; // acupuncture
  if (has(desc, 'HOME DEPOT')) return 'Home Depot';
  if (has(desc, 'AMAZON', 'AMZN')) return 'Amazon';
  if (has(desc, 'UBER EATS')) return 'Eating Out';
  if (has(desc, 'UBER')) return 'Lyft';
  // Fall back to the bank-provided category.
  return CAPONE_CATEGORY_MAP[raw] || 'Uncategorized';
}

// Map any source label/key to a ruleset.
function rulesetFor(source) {
  const s = (source || '').toLowerCase();
  if (s.includes('amex')) return 'amex';
  if (s.includes('sofi')) return 'sofi';
  if (s.includes('capital')) return 'capitalone'; // 'capital one', 'capitalone'
  return 'bankofamerica'; // 'bank of america', 'bankofamerica', 'boa'
}

/**
 * @param {string} description  merchant string
 * @param {string} rawCategory  bank-provided category (BoA) or Type (SoFi)
 * @param {string} source       source label or upload key
 * @returns {{category: string, group: string}}
 */
function categorize(description, rawCategory, source) {
  const desc = (description || '').toUpperCase();
  const raw = (rawCategory || '').toUpperCase();
  let category;
  switch (rulesetFor(source)) {
    case 'amex':
      category = amexRules(desc);
      break;
    case 'sofi':
      category = sofiRules(desc, raw);
      break;
    case 'capitalone':
      category = capitalOneRules(desc, raw);
      break;
    default:
      category = bankofamericaRules(desc, raw);
  }
  category = category || 'Uncategorized';
  return { category, group: groupFor(category) };
}

module.exports = { categorize };
