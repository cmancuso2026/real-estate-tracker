import { getDb } from '../db/index.js';
import { WEIGHTS, pointsForLetter, letterFromScore } from '../scoring/grades.js';
import type { ComponentKey, Letter } from '../scoring/types.js';

/**
 * Seed (or clear) demo data so the Phase 5 dashboard is viewable without live
 * API calls. Demo listings are tagged with a `demo-` source_id prefix; grades
 * cascade-delete with their listing, so `--clear` cleans everything up.
 *
 *   npm run seed:demo            # insert demo listings + grades + a rate
 *   npm run seed:demo -- --clear # remove all demo data
 */

const DEMO_PREFIX = 'demo-';

interface DemoListing {
  source: 'zillow' | 'realtor';
  address: string;
  city: string;
  zip: string;
  lat: number;
  lng: number;
  price: number;
  beds: number;
  baths: number;
  sqft: number;
  yearBuilt: number;
  propertyType: string;
  daysOnMarket: number;
  rent: number; // estimated whole-property monthly rent
}

// A few comps per (zip, beds, baths) cluster so price/sqft medians compute.
const LISTINGS: DemoListing[] = [
  // 33012 — 3/2 single family cluster
  { source: 'zillow', address: '845 W 44th Pl', city: 'Hialeah', zip: '33012', lat: 25.83, lng: -80.3, price: 465000, beds: 3, baths: 2, sqft: 1480, yearBuilt: 1969, propertyType: 'Single Family', daysOnMarket: 12, rent: 3300 },
  { source: 'zillow', address: '1230 W 50th St', city: 'Hialeah', zip: '33012', lat: 25.84, lng: -80.31, price: 520000, beds: 3, baths: 2, sqft: 1520, yearBuilt: 1972, propertyType: 'Single Family', daysOnMarket: 34, rent: 3250 },
  { source: 'realtor', address: '760 W 42nd St', city: 'Hialeah', zip: '33012', lat: 25.82, lng: -80.29, price: 499000, beds: 3, baths: 2, sqft: 1495, yearBuilt: 1968, propertyType: 'Single Family', daysOnMarket: 8, rent: 3200 },
  { source: 'zillow', address: '410 E 25th St', city: 'Hialeah', zip: '33012', lat: 25.85, lng: -80.28, price: 540000, beds: 3, baths: 2, sqft: 1600, yearBuilt: 1975, propertyType: 'Single Family', daysOnMarket: 51, rent: 3150 },
  // 33012 — 2/1 cluster
  { source: 'zillow', address: '233 W 29th St', city: 'Hialeah', zip: '33012', lat: 25.84, lng: -80.3, price: 360000, beds: 2, baths: 1, sqft: 980, yearBuilt: 1961, propertyType: 'Single Family', daysOnMarket: 19, rent: 2500 },
  { source: 'realtor', address: '512 W 33rd St', city: 'Hialeah', zip: '33012', lat: 25.83, lng: -80.31, price: 389000, beds: 2, baths: 1, sqft: 1010, yearBuilt: 1963, propertyType: 'Single Family', daysOnMarket: 27, rent: 2450 },
  { source: 'zillow', address: '88 E 21st St', city: 'Hialeah', zip: '33012', lat: 25.85, lng: -80.29, price: 372000, beds: 2, baths: 1, sqft: 995, yearBuilt: 1960, propertyType: 'Single Family', daysOnMarket: 6, rent: 2550 },
  // 33126 — duplex / multi
  { source: 'zillow', address: '4521 NW 7th St', city: 'Miami', zip: '33126', lat: 25.78, lng: -80.27, price: 720000, beds: 4, baths: 4, sqft: 2400, yearBuilt: 1980, propertyType: 'Duplex', daysOnMarket: 23, rent: 5600 },
  { source: 'realtor', address: '5010 NW 2nd St', city: 'Miami', zip: '33126', lat: 25.77, lng: -80.28, price: 815000, beds: 6, baths: 4, sqft: 3000, yearBuilt: 1978, propertyType: 'Multi Family', daysOnMarket: 44, rent: 7800 },
  { source: 'zillow', address: '4302 NW 5th Ter', city: 'Miami', zip: '33126', lat: 25.78, lng: -80.26, price: 690000, beds: 4, baths: 3, sqft: 2250, yearBuilt: 1982, propertyType: 'Duplex', daysOnMarket: 15, rent: 5400 },
  // 33126 — 3/2 condo-ish
  { source: 'realtor', address: '1450 NW 42nd Ave', city: 'Miami', zip: '33126', lat: 25.79, lng: -80.27, price: 430000, beds: 3, baths: 2, sqft: 1300, yearBuilt: 1990, propertyType: 'Townhouse', daysOnMarket: 9, rent: 3100 },
  { source: 'zillow', address: '1502 NW 40th Ct', city: 'Miami', zip: '33126', lat: 25.79, lng: -80.26, price: 455000, beds: 3, baths: 2, sqft: 1340, yearBuilt: 1991, propertyType: 'Townhouse', daysOnMarket: 38, rent: 3050 },
];

// Loan/operating assumptions for the demo deals.
const DOWN_PCT = 25;
const CLOSING_PCT = 3;
const TAX_PCT = 1.1;
const INS_PCT = 0.5;
const VACANCY = 0.05;
const TERM_YEARS = 30;
const BASE_RATE = 6.72;
const PREMIUM = 0.75;
const EFF_RATE = BASE_RATE + PREMIUM;

function monthlyMortgage(loan: number, annualRatePct: number, years: number): number {
  const r = annualRatePct / 100 / 12;
  const n = years * 12;
  if (r === 0) return loan / n;
  return (loan * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

function computeDeal(l: DemoListing) {
  const downPayment = l.price * (DOWN_PCT / 100);
  const closingCosts = l.price * (CLOSING_PCT / 100);
  const totalCashInvested = downPayment + closingCosts;
  const loanAmount = l.price - downPayment;
  const mMort = monthlyMortgage(loanAmount, EFF_RATE, TERM_YEARS);
  const annualMortgage = mMort * 12;
  const annualPropertyTax = l.price * (TAX_PCT / 100);
  const annualInsurance = l.price * (INS_PCT / 100);
  const effectiveRent = l.rent * (1 - VACANCY);
  const annualCashFlow =
    effectiveRent * 12 - annualMortgage - annualPropertyTax - annualInsurance;
  const monthlyCashflow = annualCashFlow / 12;
  const cocReturn = (annualCashFlow / totalCashInvested) * 100;
  const pricePerSqft = l.price / l.sqft;

  const assumptions = {
    purchasePrice: l.price,
    downPaymentPct: DOWN_PCT,
    downPayment: round2(downPayment),
    closingCosts: round2(closingCosts),
    totalCashInvested: round2(totalCashInvested),
    loanAmount: round2(loanAmount),
    interestRatePct: EFF_RATE,
    baseRatePct: BASE_RATE,
    ratePremiumPct: PREMIUM,
    loanTermYears: TERM_YEARS,
    monthlyMortgage: round2(mMort),
    annualMortgage: round2(annualMortgage),
    propertyTaxPct: TAX_PCT,
    annualPropertyTax: round2(annualPropertyTax),
    insurancePct: INS_PCT,
    annualInsurance: round2(annualInsurance),
    monthlyRent: l.rent,
    rentComps: 5,
    vacancyFactor: VACANCY,
    annualCashFlow: round2(annualCashFlow),
  };

  return {
    cocReturn: round2(cocReturn),
    monthlyCashflow: round2(monthlyCashflow),
    pricePerSqft: round2(pricePerSqft),
    assumptions,
  };
}

function gradeCoc(coc: number): Letter {
  if (coc >= 8) return 'A';
  if (coc >= 5) return 'B';
  if (coc >= 2) return 'C';
  if (coc >= 0) return 'D';
  return 'F';
}

function gradeCashflow(cf: number): Letter {
  if (cf >= 600) return 'A';
  if (cf >= 300) return 'B';
  if (cf >= 100) return 'C';
  if (cf >= 0) return 'D';
  return 'F';
}

function overallFrom(components: Record<ComponentKey, Letter>): {
  grade: Letter;
  score: number;
} {
  let score = 0;
  for (const key of Object.keys(WEIGHTS) as ComponentKey[]) {
    score += pointsForLetter(components[key]) * WEIGHTS[key];
  }
  return { grade: letterFromScore(score), score: round2(score) };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clear(): void {
  const db = getDb();
  const info = db
    .prepare(`DELETE FROM listings WHERE source_id LIKE '${DEMO_PREFIX}%'`)
    .run();
  console.log(`Removed ${info.changes} demo listing(s) (grades cascade-deleted).`);
}

function seed(): void {
  const db = getDb();

  // Latest interest rate snapshot (so the summary card shows a rate).
  db.prepare(
    `INSERT INTO interest_rates (source, week_date, base_rate, premium, effective_rate)
     VALUES ('freddie_mac_pmms', @week, @base, @premium, @eff)
     ON CONFLICT (source, week_date) DO UPDATE SET
       base_rate = excluded.base_rate, premium = excluded.premium,
       effective_rate = excluded.effective_rate, fetched_at = datetime('now')`,
  ).run({ week: '2026-06-04', base: BASE_RATE, premium: PREMIUM, eff: EFF_RATE });

  const insertListing = db.prepare(
    `INSERT INTO listings (
       source, source_id, address, city, state, zip_code, latitude, longitude,
       price, bedrooms, bathrooms, living_area, lot_size, year_built,
       property_type, days_on_market, status, listing_url, raw_json
     ) VALUES (
       @source, @source_id, @address, @city, 'FL', @zip, @lat, @lng,
       @price, @beds, @baths, @sqft, @lot, @year_built, @property_type,
       @days, 'for_sale', @url, '{}'
     )
     ON CONFLICT (source, source_id) DO UPDATE SET price = excluded.price`,
  );

  const insertGrade = db.prepare(
    `INSERT INTO grades (
       property_id, overall_grade, overall_score,
       coc_grade, cashflow_grade, sqft_grade, crime_grade, rental_grade,
       coc_return, monthly_cashflow, price_per_sqft, crime_index,
       rental_prevalence, interest_rate_used, reasoning, assumptions_json, graded_at
     ) VALUES (
       @pid, @grade, @score, @coc_g, @cf_g, @sqft_g, @crime_g, @rental_g,
       @coc, @cf, @ppsf, @crime, @rental, @rate, @reasoning, @assumptions, @graded_at
     )`,
  );

  const run = db.transaction(() => {
    let n = 0;
    LISTINGS.forEach((l, idx) => {
      const sourceId = `${DEMO_PREFIX}${idx + 1}`;
      const url =
        l.source === 'zillow'
          ? `https://www.zillow.com/homedetails/${sourceId}_zpid/`
          : `https://www.realtor.com/realestateandhomes-detail/${sourceId}`;

      const info = insertListing.run({
        source: l.source,
        source_id: sourceId,
        address: l.address,
        city: l.city,
        zip: l.zip,
        lat: l.lat,
        lng: l.lng,
        price: l.price,
        beds: l.beds,
        baths: l.baths,
        sqft: l.sqft,
        lot: l.sqft * 4,
        year_built: l.yearBuilt,
        property_type: l.propertyType,
        days: l.daysOnMarket,
        url,
      });

      const propertyId =
        Number(info.lastInsertRowid) ||
        (
          db
            .prepare('SELECT id FROM listings WHERE source = ? AND source_id = ?')
            .get(l.source, sourceId) as { id: number }
        ).id;

      const deal = computeDeal(l);
      const cocG = gradeCoc(deal.cocReturn);
      const cfG = gradeCashflow(deal.monthlyCashflow);
      // Deterministic but varied neighborhood signals.
      const sqftG: Letter = idx % 4 === 0 ? 'A' : idx % 4 === 1 ? 'B' : idx % 4 === 2 ? 'C' : 'D';
      const crimeG: Letter = l.zip === '33012' ? 'C' : 'C';
      const rentalG: Letter = l.zip === '33126' ? 'A' : 'B';
      const components: Record<ComponentKey, Letter> = {
        coc: cocG,
        cashflow: cfG,
        sqft: sqftG,
        crime: crimeG,
        rental: rentalG,
      };
      const overall = overallFrom(components);

      const crimeIndex = l.zip === '33012' ? 3120 : 3650;
      const rentalPrevalence = l.zip === '33126' ? 68 : 54;
      const reasoning =
        `Graded ${overall.grade} (score ${overall.score}/4): ` +
        `${deal.cocReturn}% cash-on-cash, ${Math.round(deal.monthlyCashflow)}/mo cash flow, ` +
        `$${deal.pricePerSqft}/sqft. Crime ${crimeG}, rental demand ${rentalG}.`;

      // Most properties get one grade; two get a short history for the chart.
      const runs = idx === 0 ? 3 : idx === 8 ? 2 : 1;
      const gradedAtFor = db.prepare("SELECT datetime('now', ?) AS t");
      for (let k = runs - 1; k >= 0; k--) {
        const daysAgo = k * 14;
        const gradedAt = (gradedAtFor.get(`-${daysAgo} days`) as { t: string }).t;
        // Earlier runs scored slightly lower (trend up to current).
        const scoreAdj = -0.25 * k;
        const score = round2(Math.max(0, overall.score + scoreAdj));
        insertGrade.run({
          pid: propertyId,
          grade: letterFromScore(score),
          score,
          coc_g: cocG,
          cf_g: cfG,
          sqft_g: sqftG,
          crime_g: crimeG,
          rental_g: rentalG,
          coc: deal.cocReturn,
          cf: deal.monthlyCashflow,
          ppsf: deal.pricePerSqft,
          crime: crimeIndex,
          rental: rentalPrevalence,
          rate: EFF_RATE,
          reasoning,
          assumptions: JSON.stringify(deal.assumptions),
          graded_at: gradedAt,
        });
      }
      n++;
    });
    return n;
  });

  const count = run();
  console.log(`Seeded ${count} demo listings with grades + an interest rate.`);
  console.log('View at http://localhost:3000 — run `npm run seed:demo -- --clear` to remove.');
}

function main(): void {
  if (process.argv.includes('--clear')) {
    clear();
  } else {
    seed();
  }
}

main();
