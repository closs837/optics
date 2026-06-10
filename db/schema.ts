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
