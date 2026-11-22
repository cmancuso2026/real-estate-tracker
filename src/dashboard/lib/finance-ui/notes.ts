import { fmt } from './format';
import type { Txn } from './types';

/** Tooltip text for noted transactions: one '+$12.00 · note' line each. */
export function noteTitle(list: Txn[]): string {
  return list.map((t) => `${fmt(t.amt)} · ${t.note}`).join('\n');
}
