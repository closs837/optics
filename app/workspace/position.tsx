'use client';
import { useState } from 'react';
import {
  ArrowUpRight,
  Bell,
  Copy,
  Link2,
  Download,
  FlaskConical,
  Pencil,
  Save,
  Trash2,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { addressLink } from '@/lib/market';
import { csv } from '@/lib/analytics';
import { explainChanges } from '@/lib/engine';
import type { MarketSnapshot, Observation, Snapshot, Watch } from '@/lib/types';
import {
  AuthLink,
  BlockStamp,
  dollars,
  download,
  EmptyState,
  healthTone,
  hf,
  Loading,
  number,
  short,
  Stat,
  timestamp,
  Token,
} from './shared';
export function Position({
  snapshot: s,
  watch,
  observations,
  historyLoading,
  stale,
  signedIn,
  market,
  save,
  rename,
  remove,
  risk,
  activity,
  rule,
}: {
  snapshot: Snapshot;
  watch: Watch | null;
  observations: Observation[];
  historyLoading: boolean;
  stale: boolean;
  signedIn: boolean;
  market: MarketSnapshot | null;
  save: () => void;
  rename: () => void;
  remove: () => void;
  risk: () => void;
  activity: () => void;
  rule: () => void;
}) {
  const supplied = s.assets.reduce((n, a) => n + Number(a.suppliedUsd), 0);
  const [tab, setTab] = useState('balances'),
    [copyNotice, setCopyNotice] = useState('');
  async function copy(kind: 'address' | 'link') {
    try {
      await navigator.clipboard.writeText(
        kind === 'address'
          ? s.address
          : window.location.origin + '/?address=' + s.address,
      );
      setCopyNotice(
        kind === 'address' ? 'Address copied.' : 'Position link copied.',
      );
    } catch {
      setCopyNotice(
        'Copy is unavailable in this browser. Select the address above to copy it.',
      );
    }
  }
  const prev = observations.length > 1 ? observations.at(-2)!.snapshot : null;
  const changes = explainChanges(prev, s);
  return (
    <>
      <div className="section-intro">
        <div>
          <div className="eyebrow">
            Positions / {watch ? 'Saved address' : 'Public lookup'}
          </div>
          <h1>{watch?.label ?? short(s.address)}</h1>
          <a
            className="address-line mono"
            href={addressLink(s.address)}
            target="_blank"
            rel="noreferrer"
          >
            {s.address}
            <ArrowUpRight size={14} />
          </a>
        </div>
        <div className="heading-actions">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Copy wallet address"
            title="Copy wallet address"
            onClick={() => void copy('address')}
          >
            <Copy size={15} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Copy position link"
            title="Copy position link"
            onClick={() => void copy('link')}
          >
            <Link2 size={15} />
          </Button>
          {watch ? (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Rename watch"
                onClick={rename}
              >
                <Pencil size={15} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Remove watch"
                onClick={remove}
              >
                <Trash2 size={15} />
              </Button>
              <Button variant="outline" onClick={rule}>
                <Bell size={14} />
                Add alert
              </Button>
            </>
          ) : signedIn ? (
            <Button onClick={save}>
              <Save size={14} />
              Save address
            </Button>
          ) : (
            <AuthLink
              className="text-link"
              href="/signin-with-chatgpt?return_to=/"
            >
              Sign in to save ↗
            </AuthLink>
          )}
          <Button variant="outline" onClick={risk}>
            <FlaskConical size={15} />
            Stress test
          </Button>
        </div>
      </div>
      {copyNotice && <output className="small-note">{copyNotice}</output>}
      {stale && (
        <p className="inline-warning">
          {watch?.lastError ??
            'This observation is more than three minutes old.'}{' '}
          The values below are from the last successful read.
        </p>
      )}
      <div className="stat-strip">
        <Stat
          label="Supplied"
          value={dollars(supplied)}
          sub={s.assets.length + ' active assets'}
        />
        <Stat
          label="Borrowed"
          value={dollars(s.debtUsd)}
          sub={'Net supplied value ' + dollars(supplied - Number(s.debtUsd))}
        />
        <Stat
          label="Health factor"
          value={hf(s.healthFactor)}
          tone={healthTone(s.healthFactor)}
          sub="Liquidation threshold: 1.000"
        />
        <Stat
          label="Available borrowing"
          value={dollars(s.availableBorrowsUsd)}
          sub="Protocol account limit"
        />
      </div>
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(String(v))}
        className="position-tabs"
      >
        <div className="section-bar">
          <TabsList variant="line">
            <TabsTrigger value="balances">Balances</TabsTrigger>
            <TabsTrigger value="history">Observation history</TabsTrigger>
            <TabsTrigger value="changes">Changes</TabsTrigger>
          </TabsList>
          <button className="text-link" onClick={activity}>
            On-chain activity <ArrowUpRight size={14} />
          </button>
        </div>
        <TabsContent value="balances">
          <div className="data-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset</TableHead>
                  <TableHead className="numeric">Oracle price</TableHead>
                  <TableHead className="numeric">Supplied</TableHead>
                  <TableHead className="numeric">Borrowed</TableHead>
                  <TableHead>Collateral</TableHead>
                  <TableHead className="numeric">Supply APR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.assets.map((a) => (
                  <TableRow key={a.address}>
                    <TableCell>
                      <a
                        className="asset-button"
                        href={addressLink(a.address)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Token symbol={a.symbol} address={a.address} />
                        <span>
                          {a.symbol}
                          <small className="mono">{short(a.address)}</small>
                        </span>
                        <ArrowUpRight size={13} />
                      </a>
                    </TableCell>
                    <TableCell className="numeric">
                      {dollars(a.priceUsd)}
                    </TableCell>
                    <TableCell className="numeric">
                      {dollars(a.suppliedUsd)}
                      <small className="cell-note">
                        {number(a.supplied, 6)} {a.symbol}
                      </small>
                    </TableCell>
                    <TableCell className="numeric">
                      {dollars(a.borrowedUsd)}
                      <small className="cell-note">
                        {number(a.borrowed, 6)} {a.symbol}
                      </small>
                    </TableCell>
                    <TableCell>
                      <span className={a.collateral ? 'positive' : 'muted'}>
                        {a.collateral ? 'Enabled' : 'Off'}
                      </span>
                    </TableCell>
                    <TableCell className="numeric positive">
                      {market?.reserves.find(
                        (r) =>
                          r.address.toLowerCase() === a.address.toLowerCase(),
                      )
                        ? number(
                            market.reserves.find(
                              (r) =>
                                r.address.toLowerCase() ===
                                a.address.toLowerCase(),
                            )!.supplyApr,
                          ) + '%'
                        : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {!s.assets.length && (
            <EmptyState title="No position in this market">
              <p>
                This address has no supplied or borrowed balance in the
                supported Tydro V3 pool.
              </p>
            </EmptyState>
          )}
          <div className="position-lower">
            <section>
              <div className="section-bar">
                <h2>Account parameters</h2>
                <span className="tag">On-chain</span>
              </div>
              <dl className="key-values">
                <dt>Collateral value</dt>
                <dd>{dollars(s.collateralUsd)}</dd>
                <dt>Current debt / collateral</dt>
                <dd>
                  {Number(s.collateralUsd) > 0
                    ? number(
                        (Number(s.debtUsd) / Number(s.collateralUsd)) * 100,
                      ) + '%'
                    : '—'}
                </dd>
                <dt>Weighted maximum LTV</dt>
                <dd>{number(s.ltvBps / 100)}%</dd>
                <dt>Weighted liquidation threshold</dt>
                <dd>{number(s.liquidationThresholdBps / 100)}%</dd>
                <dt>Efficiency mode</dt>
                <dd>{s.eMode === 0 ? 'Disabled' : 'Category ' + s.eMode}</dd>
              </dl>
            </section>
            <section>
              <div className="section-bar">
                <h2>From the last observation</h2>
                <button className="text-link" onClick={() => setTab('changes')}>
                  View all <ArrowUpRight size={14} />
                </button>
              </div>
              <div className="change-list">
                {changes.slice(0, 3).map((c, i) => (
                  <div key={i}>
                    <span className="change-dot" />
                    <div>
                      <h3>{c.title}</h3>
                      <p>{c.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
          {market && (
            <p className="small-note">
              Supply APR uses market block #{number(market.blockNumber, 0)}.
              Position balances use the block below.
            </p>
          )}
        </TabsContent>
        <TabsContent value="history">
          {historyLoading ? (
            <Loading label="Loading saved observations" />
          ) : !watch ? (
            <EmptyState title="History starts when you save">
              <p>
                Save this address to record a time series for balances, health
                factor, and changes.
              </p>
            </EmptyState>
          ) : (
            <>
              <ObservationChart observations={observations} />
              <div className="table-foot">
                <span>
                  Most recent {observations.length} of up to 120 readings shown.
                  Gaps are unobserved periods; connecting lines are visual
                  guides.
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!observations.length}
                  onClick={() =>
                    download(
                      'optics-observations.csv',
                      csv([
                        [
                          'Time',
                          'Block',
                          'Collateral USD',
                          'Debt USD',
                          'Health factor',
                          'Available borrowing USD',
                        ],
                        ...observations.map((o) => [
                          new Date(o.snapshot.observedAt).toISOString(),
                          o.snapshot.blockNumber,
                          o.snapshot.collateralUsd,
                          o.snapshot.debtUsd,
                          o.snapshot.healthFactor,
                          o.snapshot.availableBorrowsUsd,
                        ]),
                      ]),
                    )
                  }
                >
                  <Download size={14} />
                  Export readings
                </Button>
              </div>
            </>
          )}
        </TabsContent>
        <TabsContent value="changes">
          <div className="change-list full">
            {changes.map((c, i) => (
              <div key={i}>
                <span className="change-dot" />
                <div>
                  <h3>{c.title}</h3>
                  <p>{c.detail}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="small-note">
            Observed differences can include interest and oracle-price changes.
            Open on-chain activity to inspect supported protocol events.
          </p>
        </TabsContent>
      </Tabs>
      <div className="table-foot">
        <BlockStamp block={s.blockNumber} time={s.observedAt} stale={stale} />
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            download(
              'optics-position.json',
              JSON.stringify(s, null, 2),
              'application/json',
            )
          }
        >
          <Download size={14} />
          Export snapshot
        </Button>
      </div>
    </>
  );
}
function ObservationChart({ observations }: { observations: Observation[] }) {
  const [metric, setMetric] = useState('balances');
  const data = observations.map((o) => ({
    time: o.snapshot.observedAt,
    collateral: Number(o.snapshot.collateralUsd),
    debt: Number(o.snapshot.debtUsd),
    health:
      o.snapshot.healthFactor === null ? null : Number(o.snapshot.healthFactor),
  }));
  if (data.length < 2)
    return (
      <EmptyState
        title={
          data.length ? 'One observation recorded' : 'Awaiting observations'
        }
      >
        <p>
          Keep checks enabled to build a history. A chart appears after the
          second successful observation.
        </p>
      </EmptyState>
    );
  return (
    <>
      <div className="chart-heading">
        <h2>{metric === 'balances' ? 'Collateral & debt' : 'Health factor'}</h2>
        <div className="segmented-control">
          {['balances', 'health'].map((m) => (
            <button
              key={m}
              aria-pressed={metric === m}
              onClick={() => setMetric(m)}
            >
              {m === 'balances' ? 'USD balances' : 'Health factor'}
            </button>
          ))}
        </div>
      </div>
      <ChartContainer
        className="history-chart"
        config={{
          collateral: { label: 'Collateral', color: '#a69bdd' },
          debt: { label: 'Debt', color: '#d2b58f' },
          health: { label: 'Health factor', color: '#8fbfa9' },
        }}
      >
        {metric === 'balances' ? (
          <AreaChart
            data={data}
            margin={{ top: 18, left: 0, right: 15, bottom: 10 }}
          >
            <defs>
              <linearGradient id="collateral-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#a69bdd" stopOpacity={0.18} />
                <stop offset="100%" stopColor="#a69bdd" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              vertical={false}
              stroke="#282b34"
              strokeDasharray="3 5"
            />
            <XAxis
              dataKey="time"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(v) =>
                new Date(v).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              }
              tickLine={false}
              axisLine={false}
              minTickGap={50}
            />
            <YAxis
              width={72}
              tickFormatter={(v) => dollars(v)}
              tickLine={false}
              axisLine={false}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(v) => timestamp(Number(v))}
                  formatter={(v, k) => (
                    <span>
                      {String(k)}: {dollars(Number(v))}
                    </span>
                  )}
                />
              }
            />
            <Area
              type="linear"
              dataKey="collateral"
              stroke="#a69bdd"
              fill="url(#collateral-area)"
              strokeWidth={2}
              isAnimationActive={false}
            />
            <Area
              type="linear"
              dataKey="debt"
              stroke="#d2b58f"
              fill="transparent"
              strokeWidth={1.5}
              isAnimationActive={false}
            />
          </AreaChart>
        ) : (
          <LineChart
            data={data}
            margin={{ top: 18, left: 0, right: 15, bottom: 10 }}
          >
            <CartesianGrid
              vertical={false}
              stroke="#282b34"
              strokeDasharray="3 5"
            />
            <XAxis
              dataKey="time"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(v) =>
                new Date(v).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              }
              tickLine={false}
              axisLine={false}
              minTickGap={50}
            />
            <YAxis width={48} tickLine={false} axisLine={false} />
            <ReferenceLine y={1} stroke="#db8e89" strokeDasharray="4 3" />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(v) => timestamp(Number(v))}
                  formatter={(v) => <span>HF {hf(Number(v))}</span>}
                />
              }
            />
            <Line
              type="linear"
              dataKey="health"
              stroke="#8fbfa9"
              dot={false}
              connectNulls={false}
              strokeWidth={2}
              isAnimationActive={false}
            />
          </LineChart>
        )}
      </ChartContainer>
      {metric === 'health' && data.every((d) => d.health === null) && (
        <p className="small-note">
          All displayed observations have no debt; health factor is not finite.
        </p>
      )}
    </>
  );
}
