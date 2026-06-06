import 'dotenv/config';

/**
 * Centralized, validated access to environment configuration.
 *
 * Phase 1 only strictly needs RENTCAST_API_KEY and the RapidAPI credentials,
 * and only when the corresponding integration is actually invoked — so we
 * read lazily and throw a clear error at the call site rather than crashing
 * the whole process on import.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable "${name}". ` +
        `Copy .env.example to .env and fill it in.`,
    );
  }
  return value.trim();
}

function optional(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
}

export const config = {
  databasePath: optional('DATABASE_PATH', './data/tracker.db'),

  get rentcastApiKey(): string {
    return required('RENTCAST_API_KEY');
  },

  get rapidApiKey(): string {
    return required('RAPIDAPI_KEY');
  },

  get rapidApiZillowHost(): string {
    return optional('RAPIDAPI_ZILLOW_HOST', 'us-property-market1.p.rapidapi.com');
  },

  /** Parsed list of zip codes to track, from TARGET_ZIP_CODES. */
  get targetZipCodes(): string[] {
    return optional('TARGET_ZIP_CODES')
      .split(',')
      .map((z) => z.trim())
      .filter((z) => /^\d{5}$/.test(z));
  },

  /**
   * How often (in days) to refresh Rentcast rental comps per zip. Zillow
   * listings refresh on every fetch:all run (new listings appear daily), but
   * Rentcast comps change slowly and the API quota is limited, so the combined
   * pass only re-fetches a zip's comps once this many days have passed since it
   * was last refreshed. Default 7 (weekly).
   */
  get rentalRefreshDays(): number {
    return numberFromEnv('RENTAL_REFRESH_DAYS', 7);
  },

  // --- Phase 2: scoring engine ---------------------------------------------

  /** Investment-property rate premium added to the PMMS base rate (annual %). */
  get investmentRatePremium(): number {
    return numberFromEnv('INVESTMENT_RATE_PREMIUM', 0.75);
  },

  /** URL of the Freddie Mac PMMS historical CSV (30-yr FRM source). */
  get pmmsCsvUrl(): string {
    return optional(
      'FREDDIE_MAC_PMMS_CSV_URL',
      'https://www.freddiemac.com/pmms/docs/PMMS_history.csv',
    );
  },

  /** Manual override of the PMMS base rate (annual %), e.g. when offline. */
  get manualPmmsRate(): number | null {
    const raw = optional('MANUAL_PMMS_RATE');
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  },

  /**
   * FBI Crime Data API key (api.data.gov). No registration is required — the
   * shared "DEMO_KEY" works out of the box but is heavily rate-limited, so a
   * free personal key from https://api.data.gov/signup/ is recommended for
   * batch grading. The crime component maps each zip to its Miami-Dade city,
   * grades that city's police-agency crime rate against the median of the
   * tracked cities, and computes that median automatically — no manual baseline.
   */
  get fbiApiKey(): string {
    return optional('FBI_API_KEY', 'DEMO_KEY');
  },

  /** Census API key (optional — ACS allows limited keyless use). */
  get censusApiKey(): string {
    return optional('CENSUS_API_KEY');
  },

  // --- Phase 4: notifications ----------------------------------------------

  /** Incoming Slack webhook URL for A-grade alerts. */
  get slackWebhookUrl(): string {
    return required('SLACK_WEBHOOK_URL');
  },

  /**
   * SendGrid API key. Keys always start with "SG."; we defensively trim any
   * leading junk (a stray "- " prefix has shown up from copy/paste) so a
   * lightly-malformed .env still authenticates.
   */
  get sendgridApiKey(): string {
    const raw = required('SENDGRID_API_KEY');
    const at = raw.indexOf('SG.');
    return at > 0 ? raw.slice(at) : raw;
  },

  /** Verified SendGrid sender address (the "from" of the digest). */
  get sendgridFromEmail(): string {
    return required('SENDGRID_FROM_EMAIL');
  },

  /** Digest recipient(s); comma-separated addresses are supported. */
  get sendgridToEmails(): string[] {
    return required('SENDGRID_TO_EMAIL')
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
  },
};

function numberFromEnv(name: string, fallback: number): number {
  const raw = optional(name);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
