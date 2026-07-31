import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { runtimeDatabase } from './sqlite.mjs';

const database = runtimeDatabase();
try {
  database.raw.exec(
    'CREATE TABLE IF NOT EXISTS _position_lens_migrations (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at INTEGER NOT NULL)',
  );
  for (const name of (await readdir('drizzle'))
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const sql = await readFile(path.join('drizzle', name), 'utf8');
    const sha256 = createHash('sha256').update(sql).digest('hex');
    const previous = database.raw
      .prepare('SELECT sha256 FROM _position_lens_migrations WHERE name=?')
      .get(name);
    if (previous) {
      if (previous.sha256 !== sha256)
        throw new Error('Applied migration was modified: ' + name);
      continue;
    }
    database.raw.exec('BEGIN IMMEDIATE');
    try {
      database.raw.exec(sql);
      database.raw
        .prepare('INSERT INTO _position_lens_migrations VALUES(?,?,?)')
        .run(name, sha256, Date.now());
      database.raw.exec('COMMIT');
      console.log('Applied migration: ' + name);
    } catch (error) {
      database.raw.exec('ROLLBACK');
      throw error;
    }
  }
} finally {
  database.close();
}
