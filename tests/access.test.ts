import assert from 'node:assert/strict';
import test from 'node:test';
import { safeReturnPath } from '../deploy/node/return-path.ts';
const config = { APP_ORIGIN: 'https://optics.example.com' };
await test('sign-in returns only to a same-origin non-auth path', () => {
  for (const value of [
    null,
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/signin-with-chatgpt?return_to=/',
    '/signout-with-chatgpt',
    '/callback',
  ])
    assert.equal(safeReturnPath(value, config.APP_ORIGIN), '/');
  assert.equal(
    safeReturnPath('/about?from=login#details', config.APP_ORIGIN),
    '/about?from=login#details',
  );
});
