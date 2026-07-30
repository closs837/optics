import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

// Real SQLite persistence, exposing the small prepared-query contract used by
// the application. The same SQL and owner checks run on both deployment targets.
export function openDatabase(filename) {
  mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const raw = new DatabaseSync(filename);
  raw.exec(
    'PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;',
  );
  const database = {
    raw,
    prepare(sql) {
      const query = raw.prepare(sql);
      function statement(parameters = []) {
        return {
          database,
          bind(...values) {
            return statement(values);
          },
          async first(column) {
            const row = query.get(...parameters);
            return row ? (column === undefined ? row : row[column]) : null;
          },
          async all() {
            return execute();
          },
          async run() {
            return execute();
          },
          execute,
        };
        function execute() {
          const started = performance.now();
          const results = query.columns().length
            ? query.all(...parameters)
            : [];
          const result = query.columns().length
            ? { changes: 0, lastInsertRowid: 0 }
            : query.run(...parameters);
          return {
            success: true,
            results,
            meta: {
              duration: performance.now() - started,
              changes: Number(result.changes),
              last_row_id: Number(result.lastInsertRowid),
            },
          };
        }
      }
      return statement();
    },
    async batch(statements) {
      raw.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map((statement) => {
          if (statement.database !== database)
            throw new Error(
              'Cannot mix database connections in a transaction.',
            );
          return statement.execute();
        });
        raw.exec('COMMIT');
        return results;
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
    close() {
      raw.close();
    },
  };
  return database;
}

let instance;
export function runtimeDatabase() {
  if (!instance) {
    const filename = process.env.DATABASE_PATH;
    if (!filename || !path.isAbsolute(filename))
      throw new Error(
        'DATABASE_PATH must be an absolute persistent SQLite path.',
      );
    instance = openDatabase(filename);
  }
  return instance;
}
