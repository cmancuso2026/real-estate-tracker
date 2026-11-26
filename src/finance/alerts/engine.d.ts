// Types for the scheduler script (engine.js is plain JS, shared with the dashboard).
import type { Knex } from 'knex';

export interface AlertRunResult {
  rule: string;
  sent: boolean;
  error?: string | null;
  triggered?: boolean;
}

export function runAlerts(
  knex: Knex,
  opts?: { now?: Date; mode?: 'tick' | 'realtime'; send?: unknown; env?: Record<string, string | undefined> },
): Promise<AlertRunResult[]>;
export function sendTest(knex: Knex, id: number | string, opts?: Record<string, unknown>): Promise<{ sent: boolean; channel: string; triggered: boolean }>;
export function previewRule(knex: Knex, body: unknown, opts?: Record<string, unknown>): Promise<{ text: string; triggered: boolean }>;
export function composeRule(knex: Knex, rule: unknown, opts?: Record<string, unknown>): Promise<{ triggered: boolean; text: string; newEvents: unknown[]; value: unknown }>;
export function hydrate(row: Record<string, unknown>): Record<string, unknown>;
