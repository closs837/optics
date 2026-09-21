const $ = (id) => document.getElementById(id);
const form = $('account-form');
const params = new URLSearchParams(location.search);
let mode = params.get('mode') || 'login';
let resetToken = decodeURIComponent(location.hash.slice(1));
if (resetToken)
  history.replaceState(null, '', location.pathname + location.search);
let returnTo = '/';
try {
  const candidate = new URL(params.get('return_to') || '/', location.origin);
  if (
    candidate.origin === location.origin &&
    !candidate.pathname.startsWith('/auth') &&
    !candidate.pathname.includes('with-chatgpt')
  )
    returnTo = candidate.pathname + candidate.search + candidate.hash;
} catch {
  /* use the workspace */
}
function notice(message, error = false) {
  $('notice').textContent = message;
  $('notice').className = error ? 'error' : '';
  $('notice').hidden = !message;
}
async function api(path, body) {
  const result = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...(body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await result.json();
  if (!result.ok) {
    if (result.status === 429)
      throw new Error('Too many attempts. Wait a few minutes and try again.');
    if (path.endsWith('/sign-in/email'))
      throw new Error('The email or password is incorrect.');
    throw new Error(
      data.message || data.error || 'The request failed. Please try again.',
    );
  }
  return data;
}
async function refresh() {
  const { user, autoApproveDomain } = await api('/api/access');
  $('policy').textContent =
    `Accounts using @${autoApproveDomain} are approved immediately. All other registrations remain pending until the operator approves them.`;
  if (user && !['password', 'reset'].includes(mode)) {
    form.hidden = true;
    $('switch').hidden = true;
    $('recovery-note').hidden = true;
    $('account-actions').hidden = false;
    $('account-email').textContent = user.email;
    const approved = user.approval === 'approved';
    const pending = user.approval === 'pending';
    $('title').textContent =
      mode === 'logout'
        ? 'Sign out of Optics?'
        : approved
          ? 'Your workspace is ready'
          : pending
            ? 'Pending approval'
            : 'Access unavailable';
    $('description').textContent =
      mode === 'logout'
        ? 'Your saved workspace will be here when you return.'
        : approved
          ? 'Your account has been approved. Open the workspace to get started.'
          : pending
            ? 'Your account is registered. The operator must approve access before you can use the workspace.'
            : 'This account does not currently have workspace access. Contact the operator.';
    $('refresh').hidden = !pending || mode === 'logout';
    $('logout').hidden = mode !== 'logout';
    $('logout-link').hidden = mode === 'logout';
    $('workspace-link').hidden = !approved || mode === 'logout';
    $('workspace-link').href = returnTo;
    return;
  }
  if (!user && !['register', 'reset'].includes(mode)) mode = 'login';
  form.hidden = false;
  $('account-actions').hidden = true;
  $('switch').hidden = false;
  const registering = mode === 'register';
  const changing = mode === 'password';
  const resetting = mode === 'reset';
  const newPassword = registering || changing || resetting;
  $('title').textContent = registering
    ? 'Create your account'
    : changing
      ? 'Change your password'
      : resetting
        ? 'Set a new password'
        : 'Sign in to Optics';
  $('description').textContent = registering
    ? 'Register for access to the Optics workspace.'
    : newPassword
      ? 'Use a unique password with at least 12 characters.'
      : 'Use your Optics account to open your workspace.';
  for (const [field, visible] of [
    ['name', registering],
    ['email', !changing && !resetting],
    ['current', changing],
    ['confirm', newPassword],
  ]) {
    $(field + '-field').hidden = !visible;
    const input = $(field + '-field').querySelector('input');
    input.required = visible;
    input.disabled = !visible;
  }
  form.elements.password.minLength = newPassword ? 12 : 1;
  form.elements.password.autocomplete = newPassword
    ? 'new-password'
    : 'current-password';
  $('password-label').textContent = newPassword ? 'New password' : 'Password';
  $('submit').textContent = registering
    ? 'Create account ↗'
    : newPassword
      ? 'Save password ↗'
      : 'Sign in ↗';
  $('switch-label').textContent = registering
    ? 'Already registered?'
    : newPassword
      ? 'Return to'
      : 'New to Optics?';
  $('switch-link').textContent = registering
    ? 'Sign in'
    : newPassword
      ? 'your account'
      : 'Create an account';
  $('switch-link').href =
    registering || newPassword ? '/auth' : '/auth?mode=register';
  $('recovery-note').hidden = newPassword;
  if (resetting && !resetToken)
    notice('Open the complete recovery link supplied by the operator.', true);
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  notice('');
  $('submit').disabled = true;
  try {
    const fields = new FormData(form);
    const password = fields.get('password');
    if (mode !== 'login' && password !== fields.get('confirmation'))
      throw new Error('The passwords do not match.');
    if (mode === 'register') {
      await api('/api/auth/sign-up/email', {
        name: fields.get('name').trim(),
        email: fields.get('email').trim(),
        password,
      });
    } else if (mode === 'password') {
      await api('/api/auth/change-password', {
        currentPassword: fields.get('currentPassword'),
        newPassword: password,
        revokeOtherSessions: true,
      });
      location.replace('/auth');
      return;
    } else if (mode === 'reset') {
      if (!resetToken) throw new Error('A recovery link is required.');
      await api('/api/auth/reset-password', {
        token: resetToken,
        newPassword: password,
      });
      resetToken = '';
      mode = 'login';
      form.reset();
      await refresh();
      notice('Password updated. Sign in with your new password.');
      return;
    } else {
      await api('/api/auth/sign-in/email', {
        email: fields.get('email').trim(),
        password,
      });
    }
    location.replace(returnTo);
  } catch (error) {
    notice(error.message || 'Unable to connect. Try again.', true);
  } finally {
    $('submit').disabled = false;
  }
});
$('refresh').addEventListener('click', async () => {
  $('refresh').disabled = true;
  try {
    await refresh();
    notice('Approval status refreshed.');
  } catch {
    notice('Unable to refresh. Try again.', true);
  } finally {
    $('refresh').disabled = false;
  }
});
$('logout').addEventListener('click', async () => {
  $('logout').disabled = true;
  try {
    await api('/api/auth/sign-out', {});
    location.replace('/auth');
  } catch {
    notice('Unable to sign out. Try again.', true);
    $('logout').disabled = false;
  }
});
refresh().catch(() =>
  notice('Unable to load your account. Reload the page to try again.', true),
);
