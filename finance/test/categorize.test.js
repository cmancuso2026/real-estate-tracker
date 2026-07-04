const test = require('node:test');
const assert = require('node:assert');
const { categorize } = require('../lib/categorize');

// Each case: [description, rawCategory, source, expectedCategory, expectedGroup]
// Drawn from the real April-2026 ground-truth in the original dashboard.
const CASES = [
  // Bank of America
  ['UM MY CHART BILLING', '', 'bankofamerica', 'Healthcare', 'Living'],
  ['MAX APPLIANCE REPAIRUS', '', 'bankofamerica', 'Repairs', 'Investments'],
  ['CAPITAL ONE ONLINE PYMT', '', 'bankofamerica', 'Capital One', 'Financials'],
  ["MR C'S VALET", '', 'bankofamerica', 'Parking', 'Travel'],
  ['COMCAST / XFINITY', '', 'bankofamerica', 'Wifi', 'Living'],
  ['DD *DOORDASH SHOKUDO', '', 'bankofamerica', 'Eating Out', 'Food'],
  ['CPI*CANTEEN VENDING MIAMI', 'Dining', 'bankofamerica', 'Eating Out', 'Food'],
  ['SP BARK.CO', '', 'bankofamerica', 'Roman', 'Living'],
  ['THE HOME DEPOT #6322', '', 'bankofamerica', 'Home Depot', 'Investments'],
  ['NORDSTROM #0774', '', 'bankofamerica', 'Shopping', 'Living'],
  ['WWP*TRULY NOLEN 83', '', 'bankofamerica', 'Home Security', 'Living'],
  ['7-ELEVEN 37530', '', 'bankofamerica', 'Gas', 'Travel'],
  ['FAMILY DOLLAR', '', 'bankofamerica', 'Family Dollar', 'Living'],
  ['VCN*FLVITALSNEWBORNREG', '', 'bankofamerica', 'Baby Gear', 'Baby'],
  ['RAYS BARBER SHOP INC', '', 'bankofamerica', 'Healthcare', 'Living'],
  ['NEAT N TIDY', '', 'bankofamerica', 'Uncategorized', 'Other'], // cleaning svc -> review
  ['SOMETHING RANDOM', '', 'bankofamerica', 'Uncategorized', 'Other'],
  ['SOME DINER', 'DINING', 'bankofamerica', 'Eating Out', 'Food'], // raw category fallback

  // Amex (Gold + Blue share rules)
  ['UBER EATS', '', 'amex_gold', 'Eating Out', 'Food'],
  ['UBER TRIP HELP.UBER.COM', '', 'amex_gold', 'Lyft', 'Travel'], // Uber w/o EATS = ride
  ['PUBLIX #1236', '', 'amex_gold', 'Groceries', 'Food'],
  ['WHOLE FOODS SSC', '', 'amex_gold', 'Groceries', 'Food'], // space variant
  ['WILD FORK FOODS', '', 'amex_gold', 'Groceries', 'Food'],
  ['LAWNCARE* LAWNSTARTER', '', 'amex_gold', 'Lawn Care', 'Investments'],
  ['MATTERPORT', '', 'amex_gold', 'Matterport', 'Investments'],
  ['ADTSECURITY / ADT', '', 'amex_gold', 'Home Security', 'Living'],
  ['SUBWAY HQ CAFE', '', 'amex_gold', 'Eating Out', 'Food'],
  ['JETBLUE', '', 'amex_gold', 'Flights', 'Travel'],
  ['OPENAI *CHATGPT SUBSCRIPTION', '', 'amex_gold', 'Entertainment', 'Other'],
  ['SUNPASS', '', 'amex_gold', 'Sunpass', 'Travel'],
  ['DIAMOND PLUMBING', '', 'amex_blue', 'Repairs', 'Investments'],
  ['THE HOME DEPOT (Amex)', '', 'amex_blue', 'Home Depot', 'Investments'],
  ['AMAZON MARKETPLACE', '', 'amex_blue', 'Amazon', 'Living'],
  ['MARATHON 144741', '', 'amex_blue', 'Gas', 'Travel'],
  ['FL POWER & LIGHT', '', 'amex_blue', 'Electric', 'Living'],
  ['QUEST DIAGNOSTICS', '', 'amex_blue', 'Healthcare', 'Living'],
  ['TARGET PLUS', '', 'amex_blue', 'Shopping', 'Living'],
  ['PHOTO ENFORCEMENT FL', '', 'amex_blue', 'Other', 'Other'],
  ['SP HILL HOUSE HOME', '', 'amex_blue', 'Shopping', 'Living'],

  // SoFi (rawCategory carries the Type column)
  ['Franchise World', 'Direct Deposit', 'sofi', 'Paycheck', 'W2 Income'],
  ['Franchise World', 'Withdrawal', 'sofi', 'Uncategorized', 'Other'], // not a deposit
  ['CAPITAL ONE', 'Withdrawal', 'sofi', 'Capital One', 'Financials'],
  ['FREEDOM MORTGAGE', 'Withdrawal', 'sofi', '20 PITI', 'Investments'],
  ['FIGURE LENDING LLC', 'Withdrawal', 'sofi', 'Uncategorized', 'Other'],
  ['WF HOME MTG', 'Withdrawal', 'sofi', 'Other', 'Other'],
  ['WF PL CC PAYMENT', 'Withdrawal', 'sofi', 'Other', 'Other'],
  ['Interest earned', 'Interest Earned', 'sofi', 'SoFi', 'W2 Income'],
];

for (const [desc, raw, source, expCat, expGroup] of CASES) {
  test(`categorize [${source}] "${desc}" -> ${expGroup}/${expCat}`, () => {
    const { category, group } = categorize(desc, raw, source);
    assert.equal(category, expCat);
    assert.equal(group, expGroup);
  });
}

test('categorize also accepts display source labels', () => {
  assert.deepEqual(categorize('PUBLIX', '', 'Amex Blue'), { category: 'Groceries', group: 'Food' });
  assert.deepEqual(categorize('CAPITAL ONE', '', 'Bank of America'), {
    category: 'Capital One',
    group: 'Financials',
  });
});
