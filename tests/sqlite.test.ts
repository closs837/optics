import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../deploy/node/sqlite.mjs';

await test('SQLite batch rollback and reopen preserve the real database contract', async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'position-lens-sqlite-'),
  );
  const filename = path.join(directory, 'app.sqlite');
  let db = openDatabase(filename);
  try {
    db.raw.exec(
      'CREATE TABLE items (id TEXT PRIMARY KEY, value INTEGER NOT NULL)',
    );
    await db.prepare('INSERT INTO items VALUES (?,?)').bind('first', 1).run();
    await assert.rejects(
      db.batch([
        db.prepare('UPDATE items SET value=2 WHERE id=?').bind('first'),
        db.prepare('INSERT INTO items VALUES (?,?)').bind('first', 9),
      ]),
    );
    assert.equal(
      await db
        .prepare('SELECT value FROM items WHERE id=?')
        .bind('first')
        .first('value'),
      1,
    );
    db.close();
    db = openDatabase(filename);
    assert.equal(
      (await db.prepare('SELECT * FROM items').all()).results.length,
      1,
    );
    assert.equal(
      await db
        .prepare('SELECT * FROM items WHERE id=?')
        .bind('missing')
        .first(),
      null,
    );
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
