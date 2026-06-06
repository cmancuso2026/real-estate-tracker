import Database from 'better-sqlite3';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { config } from '../config.js';

/**
 * Opens (and memoizes) the SQLite connection. The parent directory is created
 * on demand so a fresh checkout works without manual setup.
 */
let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const path = resolve(process.cwd(), config.databasePath);
  mkdirSync(dirname(path), { recursive: true });

  db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
