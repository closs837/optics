export const SESSION_EXPIRED_EVENT = 'optics:session-expired';
export const SESSION_EXPIRED_MESSAGE =
  'Your session has ended. Sign in again to continue.';

export class SessionExpiredError extends Error {
  constructor() {
    super(SESSION_EXPIRED_MESSAGE);
    this.name = 'SessionExpiredError';
  }
}

export async function api<T>(
  path: string,
  method = 'GET',
  data?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    cache: 'no-store',
    credentials: 'same-origin',
    // Sign-in must be a top-level navigation, never a background fetch to an IdP.
    redirect: 'manual',
    ...(data === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }),
  });
  if (
    response.status === 401 ||
    response.type === 'opaqueredirect' ||
    (response.status >= 300 && response.status < 400)
  ) {
    if (typeof window !== 'undefined')
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    throw new SessionExpiredError();
  }
  let value: T & { error?: string };
  try {
    value = await response.json();
  } catch {
    throw new Error('The server could not complete this request. Try again.');
  }
  if (!response.ok)
    throw new Error(
      typeof value?.error === 'string'
        ? value.error
        : 'The request failed. Try again.',
    );
  return value;
}
