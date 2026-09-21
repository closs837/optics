import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createAuth } from './auth.mjs';
import { runtimeDatabase } from './sqlite.mjs';

// Operator-only: run as the application OS account over authenticated SSH.
// No approval or reset-link issuance endpoint is exposed to the browser.
const [command, address] = process.argv.slice(2);
if (!['list', 'approve', 'block', 'reset-link'].includes(command))
  throw new Error(
    'Usage: accounts.mjs list | approve EMAIL | block EMAIL | reset-link EMAIL',
  );
const db = runtimeDatabase();
try {
  if (command === 'list') {
    console.table(
      db.raw
        .prepare(
          'SELECT email, approval, createdAt FROM auth_user ORDER BY createdAt DESC',
        )
        .all(),
    );
  } else {
    const email = address?.trim().toLowerCase();
    const user = db.raw
      .prepare('SELECT id, email, approval FROM auth_user WHERE email = ?')
      .get(email ?? '');
    if (!user) throw new Error('Account not found.');
    if (command === 'reset-link') {
      const config = JSON.parse(
        await readFile(
          process.env.POSITION_LENS_CONFIG ?? '/etc/position-lens/runtime.json',
          'utf8',
        ),
      );
      const auth = createAuth(config, db.raw, {
        sendResetPassword: async ({ token }) => {
          // Fragment keeps the single-use token out of proxy access logs and Referer.
          console.log(
            config.origin + '/auth?mode=reset#' + encodeURIComponent(token),
          );
        },
      });
      await auth.api.requestPasswordReset({ body: { email } });
      console.error(
        'Private recovery link: expires in one hour. Confirm the account holder independently before sharing.',
      );
    } else {
      db.raw.exec('BEGIN IMMEDIATE');
      try {
        db.raw
          .prepare(
            'UPDATE auth_user SET approval = ?, updatedAt = ? WHERE id = ?',
          )
          .run(
            command === 'approve' ? 'approved' : 'blocked',
            Date.now(),
            user.id,
          );
        // Revocation is immediate; an approved account can sign in again.
        if (command === 'block')
          db.raw
            .prepare('DELETE FROM auth_session WHERE userId = ?')
            .run(user.id);
        db.raw
          .prepare(
            'INSERT INTO auth_approval_log (id, userId, action, createdAt) VALUES (?, ?, ?, ?)',
          )
          .run(randomUUID(), user.id, command, Date.now());
        db.raw.exec('COMMIT');
      } catch (error) {
        db.raw.exec('ROLLBACK');
        throw error;
      }
      console.log(
        command === 'approve'
          ? 'Account approved.'
          : 'Account blocked and sessions revoked.',
      );
    }
  }
} finally {
  db.close();
}
