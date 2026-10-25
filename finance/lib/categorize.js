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
  if (has(desc, 'AMERICAN EXPRESS', 'AMEX')) return 'Amex'; // card payment (bank-side outflow)
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
  // Card-side bill payment ("… PAYMENT - THANK YOU") -> Amex wash category.
  if (/PAYMENT/.test(desc) && /THANK\s*YOU/.test(desc)) return 'Amex';
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
  if (has(desc, 'AMERICAN EXPRESS', 'AMEX')) return 'Amex'; // card payment (bank-side outflow)
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
// category.
const CAPONE_CATEGORY_MAP = {
  'PAYMENT/CREDIT': 'Capital One', // card-side bill payment -> wash category
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
 * Rule-based categorizer — the ORIGINAL hardcoded merchant matcher, now used
 * only as a fallback for transactions with no history to learn from.
 *
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

// ── Confidence-based (history) categorization ───────────────────────────────
// Instead of hardcoded merchant rules, learn from how similar transactions were
// already categorized. Rules above remain the fallback for merchants with no
// history to draw from.

// A description is a "comparable" match when its token set overlaps a historical
// one by at least this Jaccard score. Jaccard (intersection / union) is the right
// measure here: it only fires when the SHARED tokens are a large fraction of the
// combined vocabulary, so two merchants that merely share a location ("MIAMI FL")
// don't match. A looser containment measure was tried and backfired — location
// tokens made a Starbucks charge "comparable" to hundreds of Miami merchants.
const SIMILARITY_THRESHOLD = 0.5;
// Need at least this many comparable historical rows before we trust a vote.
const MIN_COMPARABLE = 3;
// The winning category must hold more than this share of the weighted vote.
const CONFIDENCE_THRESHOLD = 0.9;
// Manual (user-corrected) categorizations count double in the vote.
const MANUAL_WEIGHT = 2;

// Bank ACH / transfer lines carry the originator (merchant) name first, followed
// by structured addenda — e.g.
//   "FRANCHISE WORLD DES:PAYROLL ID:CER000752935963 INDN:COLE MANCUSO CO ID:… PPD"
// Everything from the first addenda marker on is per-transaction noise: trace
// numbers, the SEC code (PPD/CCD/WEB), and the account holder's OWN name (INDN:).
// Left in, those tokens make an obvious recurring payer (Franchise World) look
// only ~18% similar to its clean counterpart AND falsely match unrelated rows
// that share generic tokens like CO/ID. Strip them so the merchant name is what
// gets compared.
const ACH_ADDENDA = /\s(?:(?:DES|INDN|ID|CO\s+ID):|(?:PPD|CCD|WEB|ARC|TEL)(?=\s|$)).*$/is;

function stripAchAddenda(str) {
  return (str || '').replace(ACH_ADDENDA, ' ');
}

// Normalize a merchant string into comparable word tokens: drop ACH addenda,
// uppercase, strip special characters and digits (store #s, phone numbers, etc.
// are noise), then keep tokens of length >= 2.
function normalizeTokens(str) {
  return stripAchAddenda(str)
    .toUpperCase()
    .replace(/['’]/g, '') // merge possessives: MCDONALD'S -> MCDONALDS (not MCDONALD + S)
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\d+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

// Count of tokens shared between two Sets.
function intersectionSize(a, b) {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter;
}

// Jaccard similarity between two token Sets: |A∩B| / |A∪B|.
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  const inter = intersectionSize(a, b);
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

/**
 * Precompute a searchable index from existing transactions. Rows without a real
 * category (Uncategorized) carry no signal and are dropped from the vote.
 *
 * The returned array also carries a `df` (document-frequency) Map and `docs`
 * count so scoreFromHistory can weight tokens by rarity (see below).
 *
 * @param {Array<{description: string, category: string, category_group: string, is_manual: any}>} rows
 * @returns {Array<{tokens: Set<string>, category: string, group: string, weight: number}>}
 */
function buildHistoryIndex(rows) {
  const index = [];
  const df = new Map(); // token -> how many history rows contain it
  for (const r of rows || []) {
    if (!r.category || r.category === 'Uncategorized') continue;
    const tokens = new Set(normalizeTokens(r.description));
    if (!tokens.size) continue;
    index.push({
      tokens,
      category: r.category,
      group: r.category_group || groupFor(r.category),
      weight: r.is_manual ? MANUAL_WEIGHT : 1,
    });
    for (const t of tokens) df.set(t, (df.get(t) || 0) + 1);
  }
  // Attach IDF data so matching can down-weight ubiquitous tokens (payment
  // prefixes like APLPAY, cities, state codes) that otherwise let unrelated
  // merchants look similar, and up-weight the distinctive merchant name.
  index.df = df;
  index.docs = index.length;
  return index;
}

/**
 * Score a description against the history index: find comparable rows and tally
 * a weighted vote over their categories.
 *
 * Similarity is an IDF-weighted Jaccard. Plain Jaccard treats every token
 * equally, so "AplPay STARBUCKS MIAMI FL" looks ~60% similar to any other Apple
 * Pay charge in Miami (3 of 4 tokens shared: APLPAY/MIAMI/FL). Weighting each
 * token by log(docs/df) makes those ubiquitous tokens count for almost nothing
 * while the rare, identifying token (STARBUCKS) dominates — so only genuine
 * same-merchant rows clear the threshold. When no IDF data is attached (e.g. a
 * raw array is passed), it degrades to plain unweighted Jaccard.
 *
 * @returns {{comparable: number, category: string|null, group: string|null, confidence: number}}
 *   comparable = number of matching historical rows (unweighted);
 *   category/group = the plurality winner; confidence = winner's weighted share.
 */
function scoreFromHistory(description, index) {
  const tokens = new Set(normalizeTokens(description));
  if (!tokens.size) return { comparable: 0, category: null, group: null, confidence: 0 };

  const entries = index || [];
  const df = entries.df; // Map, or undefined for a plain array
  const docs = entries.docs || entries.length || 0;
  // Smoothed IDF: unseen tokens (df 0) get the max weight; a token in every row
  // approaches ~1. Always positive.
  const weightOf = (t) => (df ? Math.log((docs + 1) / ((df.get(t) || 0) + 1)) + 1 : 1);
  const similarity = (a, b) => {
    let inter = 0;
    let union = 0;
    for (const t of a) {
      const w = weightOf(t);
      union += w;
      if (b.has(t)) inter += w;
    }
    for (const t of b) if (!a.has(t)) union += weightOf(t);
    return union ? inter / union : 0;
  };

  // Pick the query's DISCRIMINATOR: its rarest RECURRING token (highest IDF among
  // tokens seen in >=2 history rows). That's almost always the merchant name —
  // "PUBLIX", "MCDONALDS", "STARBUCKS" — rather than a shared location ("MIAMI",
  // "NORTH", "FL") or payment prefix ("APLPAY"). A history row votes only if it
  // contains this token, so matching keys off the merchant, not the neighborhood.
  // The df>=2 floor skips one-off store codes that survive normalization. If the
  // query has no recurring token (a brand-new merchant), fall back to the
  // IDF-weighted Jaccard so first-timers can still match look-alikes.
  let discriminator = null;
  let discWeight = -1;
  if (df) {
    for (const t of tokens) {
      if ((df.get(t) || 0) >= 2 && weightOf(t) > discWeight) {
        discWeight = weightOf(t);
        discriminator = t;
      }
    }
  }
  const isComparable = (h) =>
    discriminator ? h.tokens.has(discriminator) : similarity(tokens, h.tokens) >= SIMILARITY_THRESHOLD;

  const votes = new Map(); // category -> { weight, group }
  let comparable = 0;
  let totalWeight = 0;
  for (const h of entries) {
    if (!isComparable(h)) continue;
    comparable += 1;
    totalWeight += h.weight;
    const cur = votes.get(h.category) || { weight: 0, group: h.group };
    cur.weight += h.weight;
    votes.set(h.category, cur);
  }
  if (!comparable) return { comparable: 0, category: null, group: null, confidence: 0 };

  let best = null;
  for (const [category, v] of votes) {
    if (!best || v.weight > best.weight) best = { category, weight: v.weight, group: v.group };
  }
  return {
    comparable,
    category: best.category,
    group: best.group,
    confidence: totalWeight ? best.weight / totalWeight : 0,
  };
}

/**
 * Confidence-based categorization with rule fallback.
 *
 *  - Zero comparable history  -> hardcoded rules (confidence null).
 *  - >= MIN_COMPARABLE matches AND a category with > CONFIDENCE_THRESHOLD of the
 *    weighted vote -> that category (confidence = its share).
 *  - Otherwise (too few matches, or no clear winner) -> Uncategorized. When
 *    there WERE matches we still report the runner-up confidence so the UI can
 *    show why it wasn't sure.
 *
 * Auto-categorization never sets is_manual; the caller keeps that false.
 *
 * @param {string} description
 * @param {string} rawCategory  bank category/type (only used by the rule fallback)
 * @param {string} source       source label/key (only used by the rule fallback)
 * @param {Array} index         from buildHistoryIndex()
 * @returns {{category: string, group: string, confidence: number|null}}
 */
function categorizeWithHistory(description, rawCategory, source, index) {
  const { comparable, category, group, confidence } = scoreFromHistory(description, index);

  if (comparable === 0) {
    const r = categorize(description, rawCategory, source); // rule fallback
    return { category: r.category, group: r.group, confidence: null };
  }
  if (comparable < MIN_COMPARABLE || confidence <= CONFIDENCE_THRESHOLD) {
    return { category: 'Uncategorized', group: groupFor('Uncategorized'), confidence };
  }
  return { category, group, confidence };
}

module.exports = {
  categorize,
  buildHistoryIndex,
  scoreFromHistory,
  categorizeWithHistory,
  normalizeTokens,
  jaccard,
  SIMILARITY_THRESHOLD,
  MIN_COMPARABLE,
  CONFIDENCE_THRESHOLD,
};
