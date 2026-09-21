import assert from 'node:assert/strict';
import test from 'node:test';
import { initialApproval } from '../deploy/node/auth.mjs';
import { createAccessNotifier } from '../deploy/node/access-notifier.mjs';

await test('only the exact configured domain gets automatic approval', () => {
  for (const email of ['a@inkfnd.com', 'A@INKFND.COM'])
    assert.equal(initialApproval(email, 'inkfnd.com'), 'approved');
  for (const email of [
    'a@example.com',
    'a@team.inkfnd.com',
    'a@inkfnd.com.example',
    'a@inkfnd.co',
  ])
    assert.equal(initialApproval(email, 'inkfnd.com'), 'pending');
});

await test('access notifications are deduplicated and never interrupt access', async () => {
  const requests: unknown[] = [];
  const warnings: string[] = [];
  let time = Date.now();
  const notify = createAccessNotifier(
    {
      origin: 'https://optics.example',
      slack_webhook_url: 'https://hooks.slack.com/services/test/test/test',
    },
    {
      now: () => time,
      post: async (_url, request) => {
        assert.equal(typeof request?.body, 'string');
        requests.push(JSON.parse(request!.body as string));
        return new Response('ok');
      },
      warn: (message: string) => warnings.push(message),
    },
  );
  await notify('user@example.com');
  await notify('user@example.com');
  assert.equal(requests.length, 1);
  time += 15 * 60 * 1000;
  await notify('user@example.com');
  assert.equal(requests.length, 2);
  const failed = createAccessNotifier(
    {
      origin: 'https://optics.example',
      slack_webhook_url: 'https://hooks.slack.com/services/test/test/test',
    },
    {
      post: async () => {
        throw new Error('Contains a secret URL');
      },
      warn: (message: string) => warnings.push(message),
    },
  );
  await failed('user@example.com');
  assert.deepEqual(warnings, ['Slack access notification failed.']);
});
