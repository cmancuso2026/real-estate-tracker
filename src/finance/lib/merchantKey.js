// Merchant key: the first two significant words of a transaction description,
// with payment-rail and transfer boilerplate removed, so one merchant groups
// across sources ("ZELLE TO JOHN SMITH" → "JOHN SMITH"). Used by the review
// flags in the UI and by attribution suggestions ("the property you last picked
// for this merchant"). Ported unchanged from the old dashboard.
const KEY_NOISE = new Set([
  // rails / processors
  'ZELLE', 'VENMO', 'PAYPAL', 'PYPL', 'CASHAPP', 'SQUARE', 'SQ', 'APLPAY', 'APPLEPAY', 'GPAY',
  'PAYPALINST', 'XFER', 'TST', 'DD', 'PY', 'POS', 'ACH', 'WIRE', 'BILLPAY',
  // transfer / payment boilerplate
  'PAYMENT', 'PAYMENTS', 'PMT', 'PAY', 'TRANSFER', 'SENT', 'RECEIVED', 'FROM', 'FOR', 'WITH',
  'PURCHASE', 'DEBIT', 'CREDIT', 'CHECKCARD', 'RECURRING', 'WEB', 'ID', 'IND', 'ENTRY', 'DES',
  'PPD', 'CCD', 'TEL', 'CONF', 'REF', 'TRACE', 'TXN', 'TRN', 'AUTH', 'MEMO', 'NOTE', 'ONLINE',
  // generic english stop words
  'THE', 'INC', 'LLC', 'AND', 'OF', 'AT', 'TO', 'US', 'USA', 'COM', 'CO',
]);

/** @param {string} desc @returns {string} '' when nothing significant remains */
export function merchantKey(desc) {
  let s = ' ' + String(desc).toUpperCase() + ' ';
  s = s.replace(/[^A-Z ]+/g, ' ');
  const toks = s.split(/\s+/).filter((t) => t.length >= 3 && !KEY_NOISE.has(t));
  return toks.slice(0, 2).join(' ');
}
