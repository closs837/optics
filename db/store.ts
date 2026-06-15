import { env } from '@/db/runtime';
import type {
  AppState,
  Rule,
  Watch,
  Observation,
  AlertEvent,
  SavedScenario,
} from '@/lib/types';
import {
  matches,
  metricLabels,
  metricValue,
  shouldTrigger,
} from '@/lib/engine';
import { readPosition } from '@/lib/tydro';
export function db(): D1Database {
  if (!env.DB) throw new Error('The watchlist database is unavailable.');
  return env.DB;
}
interface WatchRow {
  id: string;
  owner_id: string;
  address: string;
  label: string;
  created_at: number;
  last_polled_at: number | null;
  last_error: string | null;
  data: string | null;
}
interface RuleRow {
  id: string;
  watch_id: string;
  metric: Rule['metric'];
  comparison: Rule['comparison'];
  threshold: string;
  enabled: number;
  was_matching: number;
  last_triggered_at: number | null;
}
export function mapRule(r: RuleRow): Rule {
  return {
    id: r.id,
    watchId: r.watch_id,
    metric: r.metric,
    comparison: r.comparison,
    threshold: r.threshold,
    enabled: !!r.enabled,
    wasMatching: !!r.was_matching,
    lastTriggeredAt: r.last_triggered_at,
  };
}
export async function state(owner: string): Promise<AppState> {
  const [ws, rs, es, ss] = await Promise.all([
    db()
      .prepare(
        'SELECT w.*, (SELECT data FROM snapshots s WHERE s.watch_id=w.id ORDER BY observed_at DESC LIMIT 1) AS data FROM watches w WHERE owner_id=? ORDER BY created_at',
      )
      .bind(owner)
      .all<WatchRow>(),
    db()
      .prepare(
        'SELECT r.* FROM rules r JOIN watches w ON w.id=r.watch_id WHERE w.owner_id=?',
      )
      .bind(owner)
      .all<RuleRow>(),
    db()
      .prepare(
        'SELECT a.* FROM alerts a JOIN watches w ON w.id=a.watch_id WHERE w.owner_id=? ORDER BY a.created_at DESC LIMIT 100',
      )
      .bind(owner)
      .all<{
        id: string;
        watch_id: string;
        rule_id: string | null;
        title: string;
        detail: string;
        created_at: number;
        block_number: string;
        read: number;
      }>(),
    db()
      .prepare(
        'SELECT s.* FROM scenarios s JOIN watches w ON w.id=s.watch_id WHERE w.owner_id=? ORDER BY s.created_at DESC',
      )
      .bind(owner)
      .all<{
        id: string;
        watch_id: string;
        name: string;
        parameters: string;
        created_at: number;
      }>(),
  ]);
  return {
    scenarios: ss.results.map(
      (s): SavedScenario => ({
        id: s.id,
        watchId: s.watch_id,
        name: s.name,
        createdAt: s.created_at,
        ...JSON.parse(s.parameters),
      }),
    ),
    watches: ws.results.map(
      (w): Watch => ({
        id: w.id,
        address: w.address,
        label: w.label,
        createdAt: w.created_at,
        lastPolledAt: w.last_polled_at,
        lastError: w.last_error,
        latest: w.data ? JSON.parse(w.data) : null,
      }),
    ),
    rules: rs.results.map(mapRule),
    alerts: es.results.map(
      (e): AlertEvent => ({
        id: e.id,
        watchId: e.watch_id,
        ruleId: e.rule_id,
        title: e.title,
        detail: e.detail,
        createdAt: e.created_at,
        blockNumber: e.block_number,
        read: !!e.read,
      }),
    ),
  };
}
export async function ownedWatch(owner: string, id: string) {
  const w = await db()
    .prepare('SELECT * FROM watches WHERE id=? AND owner_id=?')
    .bind(id, owner)
    .first<WatchRow>();
  if (!w) throw new Error('Watch not found.');
  return w;
}
export async function history(
  owner: string,
  id: string,
): Promise<Observation[]> {
  await ownedWatch(owner, id);
  const rows = await db()
    .prepare(
      'SELECT id,data FROM snapshots WHERE watch_id=? ORDER BY observed_at DESC LIMIT 120',
    )
    .bind(id)
    .all<{ id: string; data: string }>();
  return rows.results
    .reverse()
    .map((r) => ({ id: r.id, snapshot: JSON.parse(r.data) }));
}
export async function refreshWatch(owner: string, id: string) {
  const w = await ownedWatch(owner, id),
    now = Date.now();
  const claim = await db()
    .prepare(
      'UPDATE watches SET lease_until=? WHERE id=? AND owner_id=? AND lease_until<? AND (last_polled_at IS NULL OR last_polled_at<?) RETURNING id',
    )
    .bind(now + 90_000, id, owner, now, now - 45_000)
    .first();
  if (!claim) return;
  try {
    const snapshot = await readPosition(w.address);
    const rows = await db()
      .prepare('SELECT * FROM rules WHERE watch_id=?')
      .bind(id)
      .all<RuleRow>();
    const jobs: D1PreparedStatement[] = [
      db()
        .prepare(
          'INSERT OR IGNORE INTO snapshots(id,watch_id,block_number,observed_at,data) VALUES(?,?,?,?,?)',
        )
        .bind(
          crypto.randomUUID(),
          id,
          snapshot.blockNumber,
          snapshot.observedAt,
          JSON.stringify(snapshot),
        ),
    ];
    for (const row of rows.results) {
      const rule = mapRule(row);
      if (!rule.enabled) continue;
      const matching = matches(rule, snapshot),
        trigger = shouldTrigger(rule, snapshot);
      if (trigger)
        jobs.push(
          db()
            .prepare(
              'INSERT INTO alerts(id,watch_id,rule_id,title,detail,created_at,block_number) VALUES(?,?,?,?,?,?,?)',
            )
            .bind(
              crypto.randomUUID(),
              id,
              rule.id,
              `${metricLabels[rule.metric]} ${rule.comparison} your threshold`,
              `${w.label}: ${metricValue(rule.metric, snapshot[rule.metric])}; threshold ${metricValue(rule.metric, rule.threshold)}.`,
              now,
              snapshot.blockNumber,
            ),
        );
      jobs.push(
        db()
          .prepare(
            'UPDATE rules SET was_matching=?,last_triggered_at=? WHERE id=?',
          )
          .bind(
            matching ? 1 : 0,
            trigger ? now : rule.lastTriggeredAt,
            rule.id,
          ),
      );
    }
    jobs.push(
      db()
        .prepare(
          'UPDATE watches SET last_polled_at=?,last_error=NULL,lease_until=0 WHERE id=?',
        )
        .bind(now, id),
    );
    // Bounded retention: 30 days, at most 2,000 observations and 500 alert events per watch.
    jobs.push(
      db()
        .prepare(
          'DELETE FROM snapshots WHERE watch_id=? AND (observed_at<? OR id NOT IN (SELECT id FROM snapshots WHERE watch_id=? ORDER BY observed_at DESC LIMIT 2000))',
        )
        .bind(id, now - 30 * 86400_000, id),
    );
    jobs.push(
      db()
        .prepare(
          'DELETE FROM alerts WHERE watch_id=? AND id NOT IN (SELECT id FROM alerts WHERE watch_id=? ORDER BY created_at DESC LIMIT 500)',
        )
        .bind(id, id),
    );
    await db().batch(jobs);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Position refresh failed.';
    await db()
      .prepare(
        'UPDATE watches SET last_polled_at=?,last_error=?,lease_until=0 WHERE id=?',
      )
      .bind(now, message, id)
      .run();
  }
}
