// The single source of truth for the category → group taxonomy.
// Served verbatim to the frontend via GET /api/categories so the UI never
// drifts from the backend. Mirrors the GROUPS object in the spec.
const GROUPS = {
  'W2 Income': ['Paycheck', 'SoFi', 'Taxes'],
  Investments: [
    '1205 Rent', '1207 Rent', '20 Rent', '1205 PITI', '20 PITI',
    'Repairs', 'Lawn Care', 'Zillow', 'Matterport', 'Other - Home', 'Home Depot',
  ],
  Travel: [
    'Car Payment', 'Car Insurance', 'Gas', 'Car Maintenance',
    'Parking', 'Sunpass', 'Lyft', 'Boarding', 'Hotel', 'Flights',
  ],
  Food: ['Groceries', 'Eating Out', 'Restaurant'],
  'Bills & Utilities': ['Electric', 'Water', 'Wifi', 'Phone', 'Home Security'],
  Shopping: ['Amazon', 'Shopping', 'Family Dollar'],
  'Health & Personal': ['Healthcare', 'Gym', 'Career', 'Roman'],
  Fun: ['Bar', 'Entertainment', 'Gun'],
  Baby: ['Baby Gear'],
  Financials: ['Venmo', 'Capital One', 'Amex'],
  Other: ['Other', 'Uncategorized'],
};

// Reverse lookup: subcategory -> group.
const CAT_TO_GROUP = {};
for (const [group, cats] of Object.entries(GROUPS)) {
  for (const c of cats) CAT_TO_GROUP[c] = group;
}

// Given a category, return its canonical group (falls back to 'Other').
function groupFor(category) {
  return CAT_TO_GROUP[category] || 'Other';
}

export { GROUPS, CAT_TO_GROUP, groupFor };
