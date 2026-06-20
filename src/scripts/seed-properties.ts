/**
 * npm run seed:properties
 * Seeds Cole's three duplexes with their units.
 * Safe to run once — skips if properties already exist.
 */
import { query, closeDb } from '../db/index.js';
import { assertDatabaseUrl } from '../db/init.js';

const PROPERTIES = [
  {
    address: '20-22 NW 119th St',
    city: 'Miami', state: 'FL', zip_code: '33168',
    property_type: 'duplex', unit_count: 2,
    units: [
      { unit_label: '20', bedrooms: null, bathrooms: null, sqft: null },
      { unit_label: '22', bedrooms: null, bathrooms: null, sqft: null },
    ],
  },
  {
    address: '1821-1825 NW 74th St',
    city: 'Miami', state: 'FL', zip_code: '33147',
    property_type: 'duplex', unit_count: 2,
    units: [
      { unit_label: '1821', bedrooms: null, bathrooms: null, sqft: null },
      { unit_label: '1825', bedrooms: null, bathrooms: null, sqft: null },
    ],
  },
  {
    address: '1205-1207 NE 117th St',
    city: 'Miami', state: 'FL', zip_code: '33161',
    property_type: 'duplex', unit_count: 2,
    units: [
      { unit_label: '1205', bedrooms: null, bathrooms: null, sqft: null },
      { unit_label: '1207', bedrooms: null, bathrooms: null, sqft: null },
    ],
  },
];

async function main() {
  assertDatabaseUrl();
  console.log('Seeding properties…');

  for (const p of PROPERTIES) {
    // Check if already exists
    const existing = await query<{ id: number }>(
      `SELECT id FROM owned_properties WHERE address = $1`,
      [p.address]
    );

    if (existing.length > 0) {
      console.log(`  ⟳ Skipping ${p.address} — already exists (id=${existing[0]!.id})`);
      continue;
    }

    // Insert property
    const [prop] = await query<{ id: number }>(
      `INSERT INTO owned_properties (address, city, state, zip_code, property_type, unit_count)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [p.address, p.city, p.state, p.zip_code, p.property_type, p.unit_count]
    );

    console.log(`  ✓ Created ${p.address} (id=${prop!.id})`);

    // Insert units
    for (const u of p.units) {
      await query(
        `INSERT INTO units (property_id, unit_label, bedrooms, bathrooms, sqft)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (property_id, unit_label) DO NOTHING`,
        [prop!.id, u.unit_label, u.bedrooms, u.bathrooms, u.sqft]
      );
      console.log(`    ✓ Unit ${u.unit_label}`);
    }
  }

  console.log('\n✓ Done. Visit /properties to see your duplexes.');
}

main()
  .catch(err => { console.error('Seed failed:', err); process.exitCode = 1; })
  .finally(() => closeDb());
