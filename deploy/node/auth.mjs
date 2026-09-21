import { betterAuth } from 'better-auth';

export function initialApproval(email, domain) {
  return email.trim().toLowerCase().split('@')[1] === domain
    ? 'approved'
    : 'pending';
}

export function createAuth(config, database, { sendResetPassword } = {}) {
  if (typeof config.auth_secret !== 'string' || config.auth_secret.length < 43)
    throw new Error(
      'A persistent, randomly generated authentication secret is required.',
    );
  if (
    !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(
      config.auto_approve_email_domain ?? '',
    )
  )
    throw new Error('Configure an exact lowercase trial approval domain.');
  return betterAuth({
    appName: 'Optics',
    baseURL: config.origin,
    secret: config.auth_secret,
    database,
    trustedOrigins: [config.origin],
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 3600,
      ...(sendResetPassword ? { sendResetPassword } : {}),
    },
    user: {
      modelName: 'auth_user',
      additionalFields: {
        approval: {
          type: ['pending', 'approved', 'blocked'],
          required: true,
          defaultValue: 'pending',
          input: false,
        },
      },
    },
    session: {
      modelName: 'auth_session',
      expiresIn: 12 * 60 * 60,
      updateAge: 60 * 60,
      cookieCache: { enabled: false },
    },
    account: { modelName: 'auth_account', accountLinking: { enabled: false } },
    verification: { modelName: 'auth_verification' },
    rateLimit: {
      enabled: true,
      storage: 'database',
      modelName: 'auth_rate_limit',
      window: 60,
      max: 100,
      customRules: {
        '/sign-up/email': { window: 600, max: 5 },
        '/sign-in/email': { window: 60, max: 10 },
        '/reset-password': { window: 60, max: 5 },
        '/change-password': { window: 60, max: 5 },
      },
    },
    advanced: {
      useSecureCookies: true,
      ipAddress: { ipAddressHeaders: ['x-real-ip'] },
      cookies: {
        session_token: {
          name: 'optics.session_token',
          attributes: {
            secure: true,
            httpOnly: true,
            sameSite: 'lax',
            path: '/',
          },
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => ({
            data: {
              ...user,
              email: user.email.trim().toLowerCase(),
              emailVerified: false,
              approval: initialApproval(
                user.email,
                config.auto_approve_email_domain,
              ),
            },
          }),
        },
      },
    },
  });
}
