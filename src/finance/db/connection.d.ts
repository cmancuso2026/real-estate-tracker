import type { Knex } from 'knex';

export const MIGRATIONS_DIR: string;
export const MIGRATIONS_TABLE: string;
export const MIGRATION_CONFIG: Knex.MigratorConfig;
export function sslConfig(url: string): { rejectUnauthorized: boolean } | undefined;
export function financeKnexConfig(url?: string, opts?: { poolMax?: number }): Knex.Config;
export function createFinanceKnex(url?: string, opts?: { poolMax?: number }): Knex;
export function migrateFinance(
  knex: Knex,
  opts?: { lockWaitMs?: number; log?: (msg: string) => void },
): Promise<string[]>;
