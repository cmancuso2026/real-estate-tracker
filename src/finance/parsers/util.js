// Shared parsing helpers: date normalization, amount parsing, header/column
// resolution. Used by every bank parser.
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

// Convert an Excel serial date (days since 1899-12-30) to a JS Date (UTC).
function excelSerialToDate(serial) {
  const ms = Math.round((serial - 25569) * 86400 * 1000); // 25569 = 1970-01-01 in Excel serial
  return new Date(ms);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// Normalize a cell value to 'YYYY-MM-DD', or null if unparseable.
// Handles: Date objects, Excel serials, 'YYYY-MM-DD', 'MM/DD/YYYY', 'M/D/YY'.
function toISODate(value) {
  if (value == null || value === '') return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }

  if (typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value).trim())) {
    const num = Number(value);
    // Plausible Excel serial range (~1954 to ~2115). Bare integers outside this
    // are unlikely to be dates.
    if (num > 20000 && num < 90000) {
      const d = excelSerialToDate(num);
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }
  }

  const s = String(value).trim();

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdy) {
    let [, mm, dd, yy] = mdy;
    if (yy.length === 2) yy = `20${yy}`;
    return `${yy}-${pad(mm)}-${pad(dd)}`;
  }

  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getUTCFullYear()}-${pad(parsed.getUTCMonth() + 1)}-${pad(parsed.getUTCDate())}`;
  }
  return null;
}

// Parse a currency-ish string into a signed number. Handles $, commas, and
// parentheses-as-negative. Returns NaN for blanks.
function parseAmount(value) {
  if (value == null || value === '') return NaN;
  if (typeof value === 'number') return value;
  let s = String(value).trim();
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,\s]/g, '');
  if (s === '') return NaN;
  const n = Number(s);
  return Number.isNaN(n) ? NaN : sign * n;
}

// Turn an uploaded file buffer into a 2D array of raw cell values (rows of
// cells), regardless of whether it's CSV or XLSX.
function fileToRows(buffer, filename = '') {
  const isXlsx =
    /\.xlsx?$/i.test(filename) ||
    (buffer && buffer.length > 1 && buffer[0] === 0x50 && buffer[1] === 0x4b); // 'PK' zip magic

  if (isXlsx) {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  }

  const text = buffer.toString('utf8').replace(/^﻿/, ''); // strip BOM
  const result = Papa.parse(text, { skipEmptyLines: 'greedy' });
  return result.data;
}

// Find the index of the header row: the first row where any cell (trimmed,
// case-insensitive) equals one of `headerNames`.
function findHeaderRow(rows, headerNames) {
  const wanted = headerNames.map((h) => h.toLowerCase());
  for (let i = 0; i < rows.length; i += 1) {
    const cells = (rows[i] || []).map((c) => String(c).trim().toLowerCase());
    if (wanted.every((w) => cells.includes(w))) return i;
  }
  return -1;
}

// Build a { columnName -> index } map from a header row (case-insensitive,
// trimmed). Later duplicate names win (matches spreadsheet left-to-right read
// where the mapped column would override, but we key on canonical names).
function columnMap(headerRow) {
  const map = {};
  (headerRow || []).forEach((cell, i) => {
    const key = String(cell).trim().toLowerCase();
    if (key && !(key in map)) map[key] = i; // first occurrence wins
  });
  return map;
}

export {
  toISODate,
  parseAmount,
  fileToRows,
  findHeaderRow,
  columnMap,
  excelSerialToDate,
};
