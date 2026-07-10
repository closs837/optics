'use client';
import { useState } from 'react';
import { Bell, CheckCheck, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { blockLink } from '@/lib/market';
import { metricLabels, metricValue } from '@/lib/engine';
import type { AppState, Rule } from '@/lib/types';
import { EmptyState, timestamp } from './shared';
export function AlertCenter({
  state,
  busy,
  add,
  toggle,
  remove,
  mark,
  markAll,
}: {
  state: AppState;
  busy: boolean;
  add: (id: string) => void;
  toggle: (r: Rule) => void;
  remove: (id: string) => void;
  mark: (id: string) => void;
  markAll: () => void;
}) {
  const [filter, setFilter] = useState('all'),
    [unreadOnly, setUnreadOnly] = useState(false);
  const rules = state.rules.filter(
    (r) => filter === 'all' || r.watchId === filter,
  );
  const alerts = state.alerts.filter(
    (a) =>
      (filter === 'all' || a.watchId === filter) && (!unreadOnly || !a.read),
  );
  const unread = state.alerts.filter((a) => !a.read).length;
  const first = filter === 'all' ? state.watches[0]?.id : filter;
  return (
    <>
      <div className="section-intro">
        <div>
          <div className="eyebrow">Monitoring / Alerts</div>
          <h1>
            Alert center
            {unread > 0 && <span className="title-count">{unread}</span>}
          </h1>
          <p>Threshold rules and a persistent record of each match.</p>
        </div>
        <Button disabled={!first} onClick={() => add(first)}>
          <Plus size={15} />
          New rule
        </Button>
      </div>
      <div className="alert-summary">
        <div>
          <span className="status-dot" />
          <strong>{state.rules.filter((r) => r.enabled).length}</strong> active
          rules
        </div>
        <div>
          <strong>{unread}</strong> unread alerts
        </div>
        <p>
          Evaluated during checks. Rules re-arm after their condition stops
          matching.
        </p>
      </div>
      <div className="table-toolbar">
        <Select value={filter} onValueChange={(v) => v && setFilter(v)}>
          <SelectTrigger aria-label="Filter alerts by watch">
            <SelectValue>
              {filter === 'all'
                ? 'All watched addresses'
                : state.watches.find((w) => w.id === filter)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All watched addresses</SelectItem>
            {state.watches.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="sm"
          disabled={!unread || busy}
          onClick={markAll}
        >
          <CheckCheck size={15} />
          Mark all read
        </Button>
      </div>
      <Tabs defaultValue="inbox">
        <TabsList variant="line">
          <TabsTrigger value="inbox">Inbox</TabsTrigger>
          <TabsTrigger value="rules">
            Rules <span className="muted">{rules.length}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="inbox">
          <label className="unread-control" htmlFor="unread-switch">
            <Switch
              id="unread-switch"
              checked={unreadOnly}
              onCheckedChange={setUnreadOnly}
              aria-label="Show unread alerts only"
            />
            Unread only
          </label>
          {alerts.length ? (
            <div className="alert-list">
              {alerts.map((a) => (
                <article
                  key={a.id}
                  className={'alert-row ' + (!a.read ? 'unread' : '')}
                >
                  <span
                    className={'alert-indicator ' + (!a.read ? 'active' : '')}
                  />
                  <div>
                    <span className="eyebrow">
                      {state.watches.find((w) => w.id === a.watchId)?.label ??
                        'Saved watch'}
                    </span>
                    <h3>{a.title}</h3>
                    <p>{a.detail}</p>
                    <div className="event-meta">
                      <time dateTime={new Date(a.createdAt).toISOString()}>
                        {timestamp(a.createdAt)}
                      </time>
                      <a
                        href={blockLink(a.blockNumber)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Block #{a.blockNumber} ↗
                      </a>
                    </div>
                  </div>
                  {!a.read && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => mark(a.id)}
                      disabled={busy}
                    >
                      Mark read
                    </Button>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title={unreadOnly ? 'All caught up' : 'No alerts recorded'}
            >
              <p>
                Create a rule for a saved address. Its first matching check will
                appear here.
              </p>
            </EmptyState>
          )}
        </TabsContent>
        <TabsContent value="rules">
          {rules.length ? (
            <div className="rule-list">
              {rules.map((r) => (
                <div key={r.id} className="rule-row">
                  <Bell size={17} />
                  <div>
                    <span className="eyebrow">
                      {state.watches.find((w) => w.id === r.watchId)?.label}
                    </span>
                    <h3>
                      {metricLabels[r.metric]} {r.comparison}{' '}
                      <span className="mono">
                        {metricValue(r.metric, r.threshold)}
                      </span>
                    </h3>
                    <p>
                      {!r.enabled
                        ? 'Paused'
                        : r.wasMatching
                          ? 'Condition matched · awaiting recovery to re-arm'
                          : 'Active · awaiting next match'}
                      {r.lastTriggeredAt
                        ? ' · Last match ' + timestamp(r.lastTriggeredAt)
                        : ''}
                    </p>
                  </div>
                  <Switch
                    aria-label={'Enable ' + metricLabels[r.metric] + ' rule'}
                    checked={r.enabled}
                    onCheckedChange={() => toggle(r)}
                    disabled={busy}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete rule"
                    onClick={() => remove(r.id)}
                    disabled={busy}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No rules for this selection">
              <p>
                Choose a saved address and set a threshold for health factor,
                collateral, or debt.
              </p>
            </EmptyState>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
