'use client';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type SyntheticEvent,
} from 'react';
import {
  Activity,
  ArrowUpRight,
  Bell,
  BellRing,
  BookOpen,
  Check,
  ChevronRight,
  CircleDot,
  FlaskConical,
  LayoutDashboard,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Wallet,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { CHECK_INTERVAL_MS, STALE_AFTER_MS } from '@/lib/market';
import { metricLabels } from '@/lib/engine';
import {
  SESSION_EXPIRED_EVENT,
  SESSION_EXPIRED_MESSAGE,
} from '@/lib/client-api';
import type {
  AppState,
  Snapshot,
  Metric,
  Comparison,
  Observation,
  MarketSnapshot,
} from '@/lib/types';
import { api, EmptyState, Loading, short } from './workspace/shared';
import { Portfolio } from './workspace/portfolio';
import { Markets } from './workspace/markets';
const Position = lazy(() =>
  import('./workspace/position').then((m) => ({ default: m.Position })),
);
const RiskLab = lazy(() =>
  import('./workspace/risk').then((m) => ({ default: m.RiskLab })),
);
const ActivityFeed = lazy(() =>
  import('./workspace/activity').then((m) => ({ default: m.ActivityFeed })),
);
const AlertCenter = lazy(() =>
  import('./workspace/alerts').then((m) => ({ default: m.AlertCenter })),
);
const VerifiedActivity = lazy(() =>
  import('./workspace/verification').then((m) => ({
    default: m.VerifiedActivity,
  })),
);
const empty: AppState = { watches: [], rules: [], alerts: [], scenarios: [] };
const sections: Record<string, string> = {
  portfolio: 'Portfolio',
  markets: 'Markets',
  position: 'Position',
  risk: 'Risk studio',
  activity: 'On-chain activity',
  verification: 'Verified activity',
  alerts: 'Alert center',
};
export default function Monitor({
  signedIn,
  displayName,
}: {
  signedIn: boolean;
  displayName: string | null;
}) {
  const [state, setState] = useState<AppState>(empty),
    [input, setInput] = useState(''),
    [selected, setSelected] = useState<string | null>(null),
    [lookup, setLookup] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false),
    [syncing, setSyncing] = useState(false),
    [initialLoading, setInitialLoading] = useState(signedIn),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [historyData, setHistoryData] = useState<Observation[]>([]),
    [historyFor, setHistoryFor] = useState<string | null>(null),
    [view, setView] = useState('portfolio');
  const [verificationBlock, setVerificationBlock] = useState<string>();
  const observations = historyFor === selected ? historyData : [],
    historyLoading = !!selected && historyFor !== selected;
  const [saveOpen, setSaveOpen] = useState(false),
    [label, setLabel] = useState(''),
    [ruleOpen, setRuleOpen] = useState(false),
    [editOpen, setEditOpen] = useState(false),
    [removeOpen, setRemoveOpen] = useState(false);
  const [metric, setMetric] = useState<Metric>('healthFactor'),
    [comparison, setComparison] = useState<Comparison>('below'),
    [threshold, setThreshold] = useState(''),
    [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(true),
    [now, setNow] = useState(() => Date.now());
  const [sessionExpired, setSessionExpired] = useState(false);
  const desktop = useSyncExternalStore(
    subscribeDesktop,
    desktopEnabled,
    () => false,
  );
  const stateRef = useRef(state),
    selectedRef = useRef(selected),
    lookupSeq = useRef(0),
    refreshing = useRef(false),
    seenAlerts = useRef<Set<string>>(new Set()),
    initialized = useRef(false);
  const selectedWatch = state.watches.find((w) => w.id === selected) ?? null;
  const snapshot = selectedWatch?.latest ?? (selected ? null : lookup);
  const isStale =
    !!snapshot &&
    (now - snapshot.observedAt > STALE_AFTER_MS || !!selectedWatch?.lastError);
  const unread = state.alerts.filter((a) => !a.read).length;
  useEffect(() => {
    const expired = () => {
      setSessionExpired(true);
      setAuto(false);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
  }, []);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  const applyState = useCallback((next: AppState) => {
    setState(next);
    stateRef.current = next;
    if (initialized.current)
      for (const event of next.alerts)
        if (!seenAlerts.current.has(event.id) && !event.read) {
          if (
            localStorage.getItem('position-lens-desktop') === 'enabled' &&
            'Notification' in window &&
            Notification.permission === 'granted'
          ) {
            try {
              const n = new Notification(event.title, {
                body: event.detail,
                tag: event.id,
                icon: '/favicon.svg',
              });
              n.onclick = () => {
                window.focus();
                setSelected(event.watchId);
                setView('alerts');
              };
            } catch {
              /* Notification support differs across platforms; in-app alerts remain available. */
            }
          }
        }
    next.alerts.forEach((a) => seenAlerts.current.add(a.id));
    initialized.current = true;
  }, []);
  const loadHistory = useCallback(
    (id: string) =>
      api<{ history: Observation[] }>(
        `/api/state?watchId=${encodeURIComponent(id)}`,
      )
        .then((r) => {
          if (selectedRef.current === id) {
            setHistoryData(r.history);
            setHistoryFor(id);
          }
        })
        .catch((e) => {
          if (selectedRef.current === id) {
            setHistoryData([]);
            setError((e as Error).message);
          }
        })
        .finally(() => {
          if (selectedRef.current === id) setHistoryFor(id);
        }),
    [],
  );
  const refresh = useCallback(async () => {
    if (refreshing.current || !signedIn || sessionExpired) return;
    refreshing.current = true;
    setSyncing(true);
    try {
      const r = await api<AppState>('/api/refresh', 'POST', {});
      applyState(r);
      if (selectedRef.current) await loadHistory(selectedRef.current);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      refreshing.current = false;
      setSyncing(false);
      setNow(Date.now());
    }
  }, [signedIn, sessionExpired, applyState, loadHistory]);
  const viewAddress = useCallback(async (address: string) => {
    const seq = ++lookupSeq.current;
    setInput(address);
    setLoading(true);
    setError('');
    setNotice('');
    const saved = stateRef.current.watches.find(
      (w) => w.address.toLowerCase() === address.trim().toLowerCase(),
    );
    if (saved) {
      setSelected(saved.id);
      setLookup(null);
      setView('position');
      setLoading(false);
      return { address: saved.address, watchId: saved.id };
    }
    try {
      const r = await api<{ snapshot: Snapshot }>(
        `/api/position?address=${encodeURIComponent(address.trim())}`,
      );
      if (seq === lookupSeq.current) {
        setLookup(r.snapshot);
        setSelected(null);
        setHistoryData([]);
        setView('position');
      }
      return r.snapshot;
    } catch (e) {
      if (seq === lookupSeq.current) setError((e as Error).message);
      throw e;
    } finally {
      if (seq === lookupSeq.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    let live = true;
    const query = new URLSearchParams(window.location.search).get('address');
    if (signedIn)
      api<AppState>('/api/state')
        .then((r) => {
          if (!live) return;
          applyState(r);
          if (query) void viewAddress(query).catch(() => {});
          else if (r.watches.length) setSelected(r.watches[0].id);
        })
        .catch((e) => {
          if (live) setError(e.message);
        })
        .finally(() => {
          if (live) setInitialLoading(false);
        });
    const bootstrap =
      !signedIn && query
        ? setTimeout(() => {
            if (live) void viewAddress(query).catch(() => {});
          }, 0)
        : undefined;
    const clock = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      live = false;
      clearInterval(clock);
      clearTimeout(bootstrap);
    };
  }, [signedIn, applyState, viewAddress]);
  useEffect(() => {
    if (selected) {
      selectedRef.current = selected;
      void loadHistory(selected);
    } else {
      selectedRef.current = null;
    }
  }, [selected, loadHistory]);
  useEffect(() => {
    if (!signedIn || !auto || !state.watches.length) return;
    const timer = setInterval(() => void refresh(), CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [signedIn, auto, state.watches.length, refresh]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(t);
  }, [notice]);
  // Optional WebMCP entry points reuse the exact visible lookup/state flows.
  useEffect(() => {
    type Tool = {
      name: string;
      title: string;
      description: string;
      inputSchema: object;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
      execute: (input: unknown) => unknown;
    };
    const context = (
      document as unknown as {
        modelContext?: {
          registerTool: (
            tool: Tool,
            options: { signal: AbortSignal },
          ) => unknown;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const tools: Tool[] = [
      {
        name: 'view_tydro_position',
        title: 'View Tydro position',
        description:
          'Read a public Ink address and display its supported Tydro V3 position.',
        inputSchema: {
          type: 'object',
          properties: { address: { type: 'string' } },
          required: ['address'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: async (input) => {
          if (
            !input ||
            typeof input !== 'object' ||
            typeof (input as { address?: unknown }).address !== 'string'
          )
            throw new Error('An address is required.');
          return viewAddress((input as { address: string }).address);
        },
      },
      {
        name: 'read_watchlist',
        title: 'Read watchlist',
        description:
          'Return the signed-in user’s currently loaded watchlist and last observations.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: () => ({
          watches: stateRef.current.watches,
          loaded: initialized.current,
        }),
      },
    ];
    for (const tool of tools)
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {
        /* Standard not supported. */
      }
    return () => lifecycle.abort();
  }, [viewAddress]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!snapshot) return;
    await action(async () => {
      const r = await api<AppState & { watchId: string }>(
        '/api/watches',
        'POST',
        { address: snapshot.address, label },
      );
      applyState(r);
      setSelected(r.watchId);
      setLookup(null);
      setSaveOpen(false);
      setNotice('Watch saved. History starts with the first successful check.');
    });
  }
  async function addRule(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    await action(async () => {
      applyState(
        await api<AppState>('/api/rules', 'POST', {
          watchId: selected,
          metric,
          comparison,
          threshold,
        }),
      );
      setRuleOpen(false);
      setThreshold('');
      setNotice('Alert saved. It will be evaluated at the next check.');
    });
  }
  async function notifications() {
    if (!('Notification' in window)) {
      setNotice(
        'This browser does not support desktop alerts. In-app alerts are available.',
      );
      return;
    }
    if (desktop) {
      localStorage.removeItem('position-lens-desktop');
      window.dispatchEvent(new Event('position-lens-preference'));
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      localStorage.setItem('position-lens-desktop', 'enabled');
      window.dispatchEvent(new Event('position-lens-preference'));
      setNotice('Desktop alerts enabled while this app is open.');
    } else
      setNotice(
        'Desktop alerts were not enabled. Your in-app alerts still work.',
      );
  }
  const [market, setMarket] = useState<MarketSnapshot | null>(null),
    [marketLoading, setMarketLoading] = useState(true),
    [marketError, setMarketError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null),
    marketPending = useRef(false);
  const loadMarket = useCallback(async () => {
    if (marketPending.current) return;
    marketPending.current = true;
    setMarketLoading(true);
    try {
      const r = await api<{ market: MarketSnapshot }>('/api/markets');
      setMarket(r.market);
      setMarketError('');
    } catch (e) {
      setMarketError((e as Error).message);
    } finally {
      marketPending.current = false;
      setMarketLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void loadMarket(), 0);
    return () => clearTimeout(timer);
  }, [loadMarket]);
  useEffect(() => {
    if (!auto) return;
    const timer = setInterval(() => void loadMarket(), CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [auto, loadMarket]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  function chooseWatch(id: string, destination = 'position') {
    lookupSeq.current++;
    setLoading(false);
    setSelected(id);
    setLookup(null);
    setView(destination);
  }
  function focusAddress() {
    inputRef.current?.focus();
    inputRef.current?.select();
  }
  function checkAll() {
    void refresh();
    void loadMarket();
    if (!selected && lookup) void viewAddress(lookup.address).catch(() => {});
  }
  const needsPosition = ['position', 'risk', 'activity'].includes(view);
  return (
    <SidebarProvider
      style={{ '--sidebar-width': '224px' } as React.CSSProperties}
    >
      <WorkspaceNav
        view={view}
        go={setView}
        state={state}
        selected={selected}
        choose={chooseWatch}
        unread={unread}
        auto={auto}
        setAuto={setAuto}
        signedIn={signedIn}
        displayName={displayName}
        add={focusAddress}
      />
      <SidebarInset className="terminal-main">
        <header className="terminal-header">
          <div className="breadcrumb">
            <SidebarTrigger className="sidebar-toggle" />
            <span className="crumb-brand">Workspace</span>
            <ChevronRight size={12} />
            <strong>{sections[view]}</strong>
          </div>
          <div className="terminal-header-actions">
            <span className="network-label">
              <span className="ink-square" />
              Ink <span className="muted">Mainnet</span>
            </span>
            <button
              className={'notification-button ' + (desktop ? 'positive' : '')}
              aria-label={
                desktop
                  ? 'Disable desktop notifications'
                  : 'Enable desktop notifications'
              }
              onClick={() => void notifications()}
              title="Desktop notifications"
            >
              {desktop ? <BellRing size={16} /> : <Bell size={16} />}
            </button>
            <Button
              variant="outline"
              size="sm"
              disabled={syncing || marketLoading || loading}
              onClick={checkAll}
            >
              <RefreshCw
                size={14}
                className={syncing || marketLoading ? 'animate-spin' : ''}
              />
              <span>Refresh</span>
            </Button>
          </div>
        </header>
        <div className="address-bar">
          <Search size={16} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void viewAddress(input).catch(() => {});
            }}
          >
            <Input
              ref={inputRef}
              aria-label="Ink wallet address"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Look up any Ink address · 0x…"
              autoComplete="off"
              spellCheck={false}
              maxLength={42}
              required
            />
            <kbd>⌘ K</kbd>
            <Button type="submit" variant="ghost" size="sm" disabled={loading}>
              {loading ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                <ArrowUpRight size={15} />
              )}
              <span>Look up</span>
            </Button>
          </form>
        </div>
        <main className="terminal-content">
          <Suspense fallback={<Loading label="Opening workspace view" />}>
            {sessionExpired && (
              <div className="message error" role="alert">
                <CircleDot size={15} />
                <span>{SESSION_EXPIRED_MESSAGE}</span>
                <AuthLink href="/signin-with-chatgpt?return_to=/">
                  Sign in again <ArrowUpRight size={14} />
                </AuthLink>
              </div>
            )}
            {error && error !== SESSION_EXPIRED_MESSAGE && (
              <div className="message error" role="alert">
                <CircleDot size={15} />
                <span>{error}</span>
                <button onClick={() => setError('')} aria-label="Dismiss error">
                  <X size={15} />
                </button>
              </div>
            )}
            {notice && (
              <output className="message success">
                <Check size={15} />
                <span>{notice}</span>
                <button
                  onClick={() => setNotice('')}
                  aria-label="Dismiss notice"
                >
                  <X size={15} />
                </button>
              </output>
            )}
            {needsPosition && snapshot && (
              <div className="scope-bar">
                <span className="eyebrow">Selected address</span>
                {selected ? (
                  <Select
                    value={selected}
                    onValueChange={(v) => v && chooseWatch(v, view)}
                  >
                    <SelectTrigger aria-label="Select watched address">
                      <SelectValue>{selectedWatch?.label}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {state.watches.map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="mono">{short(snapshot.address)}</span>
                )}
                <span className="scope-separator" />
                {[
                  ['position', 'Balances'],
                  ['risk', 'Risk studio'],
                  ['activity', 'Activity'],
                ].map(([id, name]) => (
                  <button
                    key={id}
                    className={view === id ? 'active' : ''}
                    onClick={() => setView(id)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
            {initialLoading ? (
              <Loading label="Loading your workspace" />
            ) : loading && needsPosition ? (
              <Loading label="Reading position from Ink" />
            ) : (
              <>
                {view === 'portfolio' && (
                  <Portfolio
                    state={state}
                    now={now}
                    signedIn={signedIn}
                    market={market}
                    select={chooseWatch}
                    add={focusAddress}
                    openMarkets={() => setView('markets')}
                  />
                )}
                {view === 'markets' && (
                  <Markets
                    market={market}
                    now={now}
                    loading={marketLoading}
                    error={marketError}
                    reload={() => void loadMarket()}
                  />
                )}
                {view === 'position' && snapshot && (
                  <Position
                    key={selected ?? snapshot.address}
                    snapshot={snapshot}
                    watch={selectedWatch}
                    observations={observations}
                    historyLoading={historyLoading}
                    stale={isStale}
                    signedIn={signedIn}
                    market={market}
                    save={() => {
                      setLabel('');
                      setSaveOpen(true);
                    }}
                    rename={() => {
                      setLabel(selectedWatch?.label ?? '');
                      setEditOpen(true);
                    }}
                    remove={() => setRemoveOpen(true)}
                    risk={() => setView('risk')}
                    activity={() => setView('activity')}
                    rule={() => setRuleOpen(true)}
                  />
                )}
                {view === 'risk' && snapshot && (
                  <RiskLab
                    key={selected ?? snapshot.address}
                    snapshot={snapshot}
                    now={now}
                    stale={isStale}
                    scenarios={state.scenarios.filter(
                      (s) => s.watchId === selected,
                    )}
                    canSave={!!selected}
                    busy={busy}
                    save={async (name, inputs) => {
                      if (!selected) return false;
                      setBusy(true);
                      setError('');
                      try {
                        applyState(
                          await api<AppState>('/api/scenarios', 'POST', {
                            watchId: selected,
                            name,
                            ...inputs,
                          }),
                        );
                        setNotice(
                          'Scenario saved. Comparisons use the latest observation.',
                        );
                        return true;
                      } catch (e) {
                        setError((e as Error).message);
                        return false;
                      } finally {
                        setBusy(false);
                      }
                    }}
                    remove={(id) =>
                      void action(async () =>
                        applyState(
                          await api<AppState>('/api/scenarios', 'DELETE', {
                            id,
                          }),
                        ),
                      )
                    }
                  />
                )}
                {view === 'activity' && snapshot && (
                  <ActivityFeed
                    key={snapshot.address}
                    address={snapshot.address}
                    verify={(block) => {
                      setVerificationBlock(block);
                      setView('verification');
                    }}
                  />
                )}
                {view === 'verification' && (
                  <VerifiedActivity
                    signedIn={signedIn}
                    initialBlock={verificationBlock}
                    address={snapshot?.address}
                  />
                )}
                {needsPosition && !snapshot && (
                  <EmptyState
                    title={
                      selectedWatch
                        ? 'Waiting for a successful observation'
                        : 'Select a position to begin'
                    }
                  >
                    <p>
                      {selectedWatch?.lastError ??
                        'Look up an Ink address or choose one from your watchlist.'}
                    </p>
                    <div className="empty-actions">
                      <Button
                        onClick={
                          selectedWatch ? () => void refresh() : focusAddress
                        }
                      >
                        {selectedWatch ? 'Retry check' : 'Look up an address'}
                      </Button>
                      {selectedWatch && (
                        <Button
                          variant="ghost"
                          onClick={() => setRemoveOpen(true)}
                        >
                          Remove watch
                        </Button>
                      )}
                    </div>
                  </EmptyState>
                )}
                {view === 'alerts' && (
                  <AlertCenter
                    state={state}
                    busy={busy}
                    add={(id) => {
                      setSelected(id);
                      setRuleOpen(true);
                    }}
                    toggle={(r) =>
                      void action(async () =>
                        applyState(
                          await api<AppState>('/api/rules', 'PATCH', {
                            id: r.id,
                            enabled: !r.enabled,
                          }),
                        ),
                      )
                    }
                    remove={(id) =>
                      void action(async () =>
                        applyState(
                          await api<AppState>('/api/rules', 'DELETE', { id }),
                        ),
                      )
                    }
                    mark={(id) =>
                      void action(async () =>
                        applyState(
                          await api<AppState>('/api/alerts', 'PATCH', { id }),
                        ),
                      )
                    }
                    markAll={() =>
                      void action(async () =>
                        applyState(
                          await api<AppState>('/api/alerts', 'PATCH', {}),
                        ),
                      )
                    }
                  />
                )}
              </>
            )}
          </Suspense>
        </main>
        <footer className="terminal-footer">
          <span>
            <span className={'status-dot ' + (!auto ? 'paused' : '')} />
            {auto ? 'Checks every 60s while open' : 'Automatic checks paused'}
          </span>
          <Link href="/about">
            Coverage & methodology <ArrowUpRight size={12} />
          </Link>
          <span className="footer-version">Optics / 02</span>
        </footer>
      </SidebarInset>
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save this watch</DialogTitle>
            <DialogDescription>
              Start recording observations for{' '}
              {snapshot ? short(snapshot.address) : 'this address'}.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="form-stack">
            <Label htmlFor="watch-label">Label</Label>
            <Input
              id="watch-label"
              placeholder="e.g. Main lending position"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={48}
            />
            <p className="muted text-sm">
              Watchlists and observations are saved to your account.
            </p>
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save watch'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename watch</DialogTitle>
            <DialogDescription>
              Give this address a label you recognize.
            </DialogDescription>
          </DialogHeader>
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                applyState(
                  await api<AppState>('/api/watches', 'PATCH', {
                    id: selected,
                    label,
                  }),
                );
                setEditOpen(false);
              });
            }}
          >
            <Label htmlFor="edit-label">Label</Label>
            <Input
              id="edit-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={48}
              required
            />
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy}>
              Save label
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={ruleOpen} onOpenChange={setRuleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add an alert rule</DialogTitle>
            <DialogDescription>
              For {selectedWatch?.label}. A matching first check also creates an
              alert.
            </DialogDescription>
          </DialogHeader>
          <form className="form-stack" onSubmit={addRule}>
            <Label htmlFor="rule-watch">Watched address</Label>
            <Select
              value={selected ?? ''}
              onValueChange={(v) => {
                if (v) setSelected(v);
              }}
            >
              <SelectTrigger id="rule-watch">
                <SelectValue>
                  {selectedWatch?.label ?? 'Select address'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {state.watches.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Label htmlFor="metric">Metric</Label>
            <Select
              value={metric}
              onValueChange={(v) => {
                if (v) setMetric(v as Metric);
              }}
            >
              <SelectTrigger id="metric" className="w-full">
                <SelectValue>{metricLabels[metric]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(metricLabels).map(([key, text]) => (
                  <SelectItem key={key} value={key}>
                    {text}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Label htmlFor="comparison">Alert when</Label>
            <Select
              value={comparison}
              onValueChange={(v) => {
                if (v) setComparison(v as Comparison);
              }}
            >
              <SelectTrigger id="comparison" className="w-full">
                <SelectValue>
                  {comparison === 'below' ? 'Falls below' : 'Rises above'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="below">Falls below</SelectItem>
                <SelectItem value="above">Rises above</SelectItem>
              </SelectContent>
            </Select>
            <Label htmlFor="threshold">
              Threshold {metric === 'healthFactor' ? '' : '(USD)'}
            </Label>
            <Input
              id="threshold"
              inputMode="decimal"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder="Enter your threshold"
              required
            />
            <p className="muted text-sm">
              You choose the threshold. This is not a recommended borrowing or
              risk level.
            </p>
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Create rule'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this watch?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes {selectedWatch?.label}, its saved observations,
              rules, and alerts from your account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep watch</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const r = await api<AppState>('/api/watches', 'DELETE', {
                    id: selected,
                  });
                  applyState(r);
                  setSelected(r.watches[0]?.id ?? null);
                  setLookup(null);
                  setRemoveOpen(false);
                })
              }
            >
              Remove watch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  );
}

function WorkspaceNav({
  view,
  go,
  state,
  selected,
  choose,
  unread,
  auto,
  setAuto,
  signedIn,
  displayName,
  add,
}: {
  view: string;
  go: (v: string) => void;
  state: AppState;
  selected: string | null;
  choose: (id: string) => void;
  unread: number;
  auto: boolean;
  setAuto: (v: boolean) => void;
  signedIn: boolean;
  displayName: string | null;
  add: () => void;
}) {
  const { setOpenMobile } = useSidebar();
  const navigate = (fn: () => void) => {
    fn();
    setOpenMobile(false);
  };
  const links = [
    { id: 'portfolio', name: 'Portfolio', icon: LayoutDashboard },
    { id: 'markets', name: 'Markets', icon: SlidersHorizontal },
    { id: 'position', name: 'Position', icon: Wallet },
    { id: 'risk', name: 'Risk studio', icon: FlaskConical },
    { id: 'activity', name: 'Activity', icon: Activity },
    { id: 'verification', name: 'Verified activity', icon: ShieldCheck },
    { id: 'alerts', name: 'Alert center', icon: Bell },
  ];
  return (
    <Sidebar className="terminal-sidebar" collapsible="offcanvas">
      <SidebarHeader>
        <Link className="optics-brand" href="/" aria-label="Optics home">
          <span className="optics-mark" aria-hidden="true">
            <i />
            <i />
          </span>
          <span>OPTICS</span>
          <small>INK</small>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarMenu>
            {links.map((item) => (
              <SidebarMenuItem key={item.id}>
                <SidebarMenuButton
                  className={
                    item.id === 'verification' ? 'verification-nav' : undefined
                  }
                  isActive={view === item.id}
                  onClick={() => navigate(() => go(item.id))}
                >
                  <item.icon size={17} />
                  <span>{item.name}</span>
                  {item.id === 'verification' && (
                    <span className="nav-count">LAB</span>
                  )}
                  {item.id === 'alerts' && unread > 0 && (
                    <span className="nav-count">{unread}</span>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup className="watch-nav">
          <div className="watch-nav-heading">
            <SidebarGroupLabel>
              Watchlist{' '}
              <span>{state.watches.length.toString().padStart(2, '0')}</span>
            </SidebarGroupLabel>
            <button onClick={() => navigate(add)} aria-label="Add address">
              <Plus size={14} />
            </button>
          </div>
          <SidebarMenu>
            {state.watches.map((w) => (
              <SidebarMenuItem key={w.id}>
                <SidebarMenuButton
                  isActive={
                    selected === w.id &&
                    ['position', 'risk', 'activity'].includes(view)
                  }
                  onClick={() => navigate(() => choose(w.id))}
                >
                  <span
                    className={'watch-dot ' + (w.lastError ? 'warn' : '')}
                  />
                  <span className="watch-nav-label">
                    {w.label}
                    <small>{short(w.address)}</small>
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
          {!state.watches.length && (
            <p className="watch-nav-empty">Saved addresses will appear here.</p>
          )}
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="monitor-setting">
          <div>
            <span>Automatic checks</span>
            <Switch
              checked={auto}
              onCheckedChange={setAuto}
              aria-label="Automatic checks"
            />
          </div>
          <p>Every 60 seconds while this app is open.</p>
        </div>
        <Link className="sidebar-docs" href="/about">
          <BookOpen size={15} />
          Methodology
          <ArrowUpRight size={13} />
        </Link>
        {signedIn ? (
          <AuthLink
            className="account-link"
            href="/signout-with-chatgpt?return_to=/"
            title="Sign out"
          >
            <span className="avatar">
              {(displayName ?? 'U').slice(0, 1).toUpperCase()}
            </span>
            <span>
              {displayName ?? 'Your account'}
              <small>Personal workspace</small>
            </span>
            <ArrowUpRight size={14} />
          </AuthLink>
        ) : (
          <AuthLink
            className="account-link"
            href="/signin-with-chatgpt?return_to=/"
          >
            <span className="avatar">+</span>
            <span>
              Sign in to save<small>Your personal workspace</small>
            </span>
            <ArrowUpRight size={14} />
          </AuthLink>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
function desktopEnabled() {
  return (
    typeof window !== 'undefined' &&
    localStorage.getItem('position-lens-desktop') === 'enabled' &&
    'Notification' in window &&
    Notification.permission === 'granted'
  );
}
function subscribeDesktop(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener('focus', callback);
  window.addEventListener('position-lens-preference', callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener('focus', callback);
    window.removeEventListener('position-lens-preference', callback);
  };
}
function AuthLink({
  href,
  children,
  className,
  title,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <a href={href} target="_top" className={className} title={title}>
      {children}
    </a>
  );
}
