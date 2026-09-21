export function safeReturnPath(value: string | null, origin: string) {
  if (!value?.startsWith('/') || value.startsWith('//')) return '/';
  try {
    const target = new URL(value, origin);
    if (
      target.origin !== origin ||
      [
        '/auth',
        '/signin-with-chatgpt',
        '/signout-with-chatgpt',
        '/callback',
      ].includes(target.pathname)
    )
      return '/';
    return target.pathname + target.search + target.hash;
  } catch {
    return '/';
  }
}
