import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
export const watches = sqliteTable(
  'watches',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    address: text('address').notNull(),
    label: text('label').notNull(),
    createdAt: integer('created_at').notNull(),
    lastPolledAt: integer('last_polled_at'),
    lastError: text('last_error'),
    leaseUntil: integer('lease_until').notNull().default(0),
  },
  (t) => [uniqueIndex('idx_watches_owner_address').on(t.ownerId, t.address)],
);
export const snapshots = sqliteTable(
  'snapshots',
  {
    id: text('id').primaryKey(),
    watchId: text('watch_id')
      .notNull()
      .references(() => watches.id, { onDelete: 'cascade' }),
    blockNumber: text('block_number').notNull(),
    observedAt: integer('observed_at').notNull(),
    data: text('data').notNull(),
  },
  (t) => [
    uniqueIndex('idx_snapshots_watch_block').on(t.watchId, t.blockNumber),
    index('idx_snapshots_watch_time').on(t.watchId, t.observedAt),
  ],
);
export const rules = sqliteTable(
  'rules',
  {
    id: text('id').primaryKey(),
    watchId: text('watch_id')
      .notNull()
      .references(() => watches.id, { onDelete: 'cascade' }),
    metric: text('metric').notNull(),
    comparison: text('comparison').notNull(),
    threshold: text('threshold').notNull(),
    enabled: integer('enabled').notNull().default(1),
    wasMatching: integer('was_matching').notNull().default(0),
    lastTriggeredAt: integer('last_triggered_at'),
  },
  (t) => [index('idx_rules_watch').on(t.watchId)],
);
export const alerts = sqliteTable(
  'alerts',
  {
    id: text('id').primaryKey(),
    watchId: text('watch_id')
      .notNull()
      .references(() => watches.id, { onDelete: 'cascade' }),
    ruleId: text('rule_id').references(() => rules.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    detail: text('detail').notNull(),
    createdAt: integer('created_at').notNull(),
    blockNumber: text('block_number').notNull(),
    read: integer('read').notNull().default(0),
  },
  (t) => [index('idx_alerts_watch_time').on(t.watchId, t.createdAt)],
);
export const rateLimits = sqliteTable('rate_limits', {
  key: text('key').primaryKey(),
  bucket: integer('bucket').notNull(),
  count: integer('count').notNull(),
});
export const verificationSessions = sqliteTable('verification_sessions', {
  ownerId: text('owner_id').primaryKey(),
  version: integer('version').notNull().default(0),
  data: text('data').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
export const scenarios = sqliteTable(
  'scenarios',
  {
    id: text('id').primaryKey(),
    watchId: text('watch_id')
      .notNull()
      .references(() => watches.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    parameters: text('parameters').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_scenarios_watch').on(t.watchId)],
);

// Local Lightsail accounts. Approval is independent of email verification.
export const authUser = sqliteTable(
  'auth_user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: integer('emailVerified', { mode: 'boolean' })
      .notNull()
      .default(false),
    image: text('image'),
    createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
    approval: text('approval', { enum: ['pending', 'approved', 'blocked'] })
      .notNull()
      .default('pending'),
  },
  (t) => [index('idx_auth_user_approval').on(t.approval)],
);

export const authSession = sqliteTable(
  'auth_session',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    userId: text('userId')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
  },
  (t) => [index('idx_auth_session_user').on(t.userId)],
);

export const authAccount = sqliteTable(
  'auth_account',
  {
    id: text('id').primaryKey(),
    accountId: text('accountId').notNull(),
    providerId: text('providerId').notNull(),
    userId: text('userId')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    accessToken: text('accessToken'),
    refreshToken: text('refreshToken'),
    idToken: text('idToken'),
    accessTokenExpiresAt: integer('accessTokenExpiresAt', {
      mode: 'timestamp_ms',
    }),
    refreshTokenExpiresAt: integer('refreshTokenExpiresAt', {
      mode: 'timestamp_ms',
    }),
    scope: text('scope'),
    password: text('password'),
    createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('idx_auth_account_user').on(t.userId),
    uniqueIndex('idx_auth_account_provider').on(t.providerId, t.accountId),
  ],
);

export const authVerification = sqliteTable(
  'auth_verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('idx_auth_verification_identifier').on(t.identifier)],
);

export const authRateLimit = sqliteTable('auth_rate_limit', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: integer('lastRequest').notNull(),
});

export const authApprovalLog = sqliteTable(
  'auth_approval_log',
  {
    id: text('id').primaryKey(),
    userId: text('userId')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    createdAt: integer('createdAt').notNull(),
  },
  (t) => [index('idx_auth_approval_log_user').on(t.userId)],
);
