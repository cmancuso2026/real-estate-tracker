import type { ComponentGrade, ComponentKey, Letter } from './types.js';

/**
 * Build a plain-English explanation of why a property earned its grade, e.g.
 * "Strong cash-on-cash return of 7.2% driven by below-median price/sqft,
 *  offset by above-average crime for an SFH in this zip."
 *
 * We describe each present component as a clause, ordered by weight, then note
 * any components that were skipped for lack of data.
 */
export interface ReasoningInput {
  overallGrade: Letter;
  components: Partial<Record<ComponentKey, ComponentGrade>>;
  isMultiFamily: boolean;
  skipped: ComponentKey[];
}

const ORDER: ComponentKey[] = ['coc', 'cashflow', 'sqft', 'crime', 'rental'];

export function buildReasoning(input: ReasoningInput): string {
  const { overallGrade, components, isMultiFamily, skipped } = input;
  const dwelling = isMultiFamily ? 'a multi-family property' : 'an SFH';

  const clauses = ORDER.map((key) => components[key])
    .filter((c): c is ComponentGrade => c !== undefined)
    .map(clauseFor);

  let body: string;
  if (clauses.length === 0) {
    body = 'No scoring components could be computed from available data.';
  } else if (clauses.length === 1) {
    body = capitalize(clauses[0] as string) + '.';
  } else {
    const [first, ...rest] = clauses;
    body = `${capitalize(first as string)}, with ${joinList(rest)}.`;
  }

  let text = `Overall grade ${overallGrade} for ${dwelling}: ${body}`;

  if (skipped.length > 0) {
    text += ` (${skipped.map(label).join(', ')} unavailable — weights renormalized.)`;
  }
  return text;
}

function clauseFor(c: ComponentGrade): string {
  switch (c.key) {
    case 'coc':
      return `${strength(c.letter)} cash-on-cash return of ${fmtPct(c.value)}`;
    case 'cashflow':
      return `${strength(c.letter)} monthly cash flow of ${fmtMoney(c.value)}/mo`;
    case 'sqft':
      return c.value <= 0
        ? `price/sqft ${fmtPct(Math.abs(c.value))} below the zip median (grade ${c.letter})`
        : `price/sqft ${fmtPct(c.value)} above the zip median (grade ${c.letter})`;
    case 'crime':
      return c.value <= 0
        ? `crime ${fmtPct(Math.abs(c.value))} below the county median (grade ${c.letter})`
        : `crime ${fmtPct(c.value)} above the county median (grade ${c.letter})`;
    case 'rental':
      return `${fmtPct(c.value)} renter-occupied in this zip (grade ${c.letter})`;
    default:
      return '';
  }
}

function strength(letter: Letter): string {
  switch (letter) {
    case 'A':
      return 'strong';
    case 'B':
      return 'solid';
    case 'C':
      return 'modest';
    case 'D':
      return 'weak';
    case 'F':
      return 'poor';
  }
}

const LABELS: Record<ComponentKey, string> = {
  coc: 'cash-on-cash',
  cashflow: 'cash flow',
  sqft: 'price/sqft',
  crime: 'crime',
  rental: 'rental prevalence',
};
function label(key: ComponentKey): string {
  return LABELS[key];
}

function joinList(items: string[]): string {
  if (items.length === 1) return items[0] as string;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function fmtPct(n: number): string {
  return `${(Math.round(n * 10) / 10).toFixed(1)}%`;
}
function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}
function capitalize(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}
