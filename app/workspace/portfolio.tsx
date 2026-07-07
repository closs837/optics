'use client';
import { useState } from 'react';
import { ArrowUpRight, Download, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import { csv, portfolio } from '@/lib/analytics';
import type { AppState, MarketSnapshot } from '@/lib/types';
import {
  AuthLink,
  dollars,
  download,
  EmptyState,
  healthTone,
  hf,
  number,
  short,
  Stat,
  Token,
} from './shared';
export function Portfolio({
  state,
  now,
  signedIn,
  market,
  select,
  add,
  openMarkets,
}: {
  state: AppState;
  now: number;
  signedIn: boolean;
  market: MarketSnapshot | null;
  select: (id: string) => void;
  add: () => void;
  openMarkets: () => void;
}) {
  const [filter, setFilter] = useState('');
  const p = portfolio(state.watches, now);
  const rows = state.watches.filter((w) =>
    (w.label + w.address).toLowerCase().includes(filter.toLowerCase()),
  );
  const totalsAvailable = p.observed > 0;
  return (
    <>
      <div className="section-intro">
        <div>
          <div className="eyebrow">Workspace / Overview</div>
          <h1>Portfolio</h1>
          <p>Your lending positions, in one place.</p>
        </div>
        <Button onClick={add}>
          <Plus size={16} />
          Add address
        </Button>
      </div>
      <div className="portfolio-head">
        <div className="net-worth">
          <span className="stat-label">Net supplied value</span>
          <strong>
            {totalsAvailable ? dollars(p.net) : '—'}
            <small>USD</small>
          </strong>
          <span className="small-note">
            Supply minus debt across {p.observed} observed{' '}
            {p.observed === 1 ? 'address' : 'addresses'}
          </span>
        </div>
        <div className="overview-stats">
          <Stat
            label="Supplied"
            value={totalsAvailable ? dollars(p.supplied) : '—'}
          />
          <Stat
            label="Borrowed"
            value={totalsAvailable ? dollars(p.debt) : '—'}
          />
          <Stat
            label="Lowest health factor"
            value={totalsAvailable ? hf(p.lowestHealthFactor) : '—'}
            tone={healthTone(p.lowestHealthFactor)}
          />
        </div>
      </div>
      {(p.stale > 0 || p.missing > 0) && (
        <p className="inline-warning">
          Portfolio totals include {p.stale} stale{' '}
          {p.stale === 1 ? 'read' : 'reads'}; {p.missing}{' '}
          {p.missing === 1 ? 'address has' : 'addresses have'} no observation
          yet. Each address is valued at its own last observed block.
        </p>
      )}
      <div className="section-bar">
        <h2>
          Watched positions{' '}
          <span>{state.watches.length.toString().padStart(2, '0')}</span>
        </h2>
        <Button
          variant="ghost"
          size="sm"
          disabled={!p.observed}
          onClick={() =>
            download(
              'optics-portfolio.csv',
              csv([
                [
                  'Label',
                  'Address',
                  'Collateral USD',
                  'Debt USD',
                  'Health factor',
                  'Observed at',
                  'Block',
                ],
                ...state.watches.map((w) => [
                  w.label,
                  w.address,
                  w.latest?.collateralUsd ?? null,
                  w.latest?.debtUsd ?? null,
                  w.latest?.healthFactor ?? null,
                  w.latest ? new Date(w.latest.observedAt).toISOString() : null,
                  w.latest?.blockNumber ?? null,
                ]),
              ]),
            )
          }
        >
          <Download size={14} />
          Export
        </Button>
      </div>
      {state.watches.length ? (
        <>
          <div className="table-toolbar">
            <div className="filter-input">
              <Search size={15} />
              <Input
                aria-label="Filter watched positions"
                placeholder="Filter address or label"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <span className="small-note">12 address capacity</span>
          </div>
          <div className="data-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Position</TableHead>
                  <TableHead className="numeric">Supplied</TableHead>
                  <TableHead className="numeric">Debt</TableHead>
                  <TableHead className="numeric">Net value</TableHead>
                  <TableHead className="numeric">Health factor</TableHead>
                  <TableHead>Last check</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((w) => {
                  const s = w.latest,
                    supply =
                      s?.assets.reduce(
                        (n, a) => n + Number(a.suppliedUsd),
                        0,
                      ) ?? 0;
                  return (
                    <TableRow key={w.id}>
                      <TableCell>
                        <button
                          className="position-link"
                          onClick={() => select(w.id)}
                        >
                          <strong>{w.label}</strong>
                          <small className="mono">{short(w.address)}</small>
                        </button>
                      </TableCell>
                      <TableCell className="numeric">
                        {s ? dollars(supply) : '—'}
                      </TableCell>
                      <TableCell className="numeric">
                        {s ? dollars(s.debtUsd) : '—'}
                      </TableCell>
                      <TableCell className="numeric">
                        {s ? dollars(supply - Number(s.debtUsd)) : '—'}
                      </TableCell>
                      <TableCell
                        className={
                          'numeric ' + healthTone(s?.healthFactor ?? null)
                        }
                      >
                        {s ? hf(s.healthFactor) : '—'}
                      </TableCell>
                      <TableCell>
                        <span
                          className={
                            'status-label ' +
                            (w.lastError || (s && now - s.observedAt > 180000)
                              ? 'amber'
                              : '')
                          }
                        >
                          {w.lastError
                            ? 'Read failed'
                            : !s
                              ? 'Pending'
                              : now - s.observedAt > 180000
                                ? 'Stale'
                                : 'Observed'}
                        </span>
                        <small className="cell-note">
                          {s
                            ? Math.max(
                                0,
                                Math.floor((now - s.observedAt) / 60000),
                              ) + 'm ago'
                            : 'No data'}
                        </small>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={'Open ' + w.label}
                          onClick={() => select(w.id)}
                        >
                          <ArrowUpRight size={16} />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {!rows.length && (
            <p className="table-empty">No positions match this filter.</p>
          )}
        </>
      ) : (
        <EmptyState title="Add the first address to your portfolio">
          <p>
            Track public Tydro positions, collect observations, and set your own
            alert rules.
          </p>
          <div className="empty-actions">
            <Button variant="outline" onClick={add}>
              <Plus size={15} />
              Look up an address
            </Button>
            {!signedIn && (
              <AuthLink
                className="text-link"
                href="/signin-with-chatgpt?return_to=/"
              >
                Sign in to save <ArrowUpRight size={14} />
              </AuthLink>
            )}
          </div>
        </EmptyState>
      )}
      <div className="overview-bottom">
        <section>
          <div className="section-bar">
            <h2>Asset exposure</h2>
            <span className="small-note">Supplied value / USD</span>
          </div>
          {p.assets.length ? (
            <>
              <div className="exposure-band">
                {p.assets
                  .filter((a) => a.supplied > 0)
                  .map((a, i) => (
                    <span
                      key={a.address}
                      title={a.symbol + ': ' + dollars(a.supplied)}
                      style={{
                        flex: a.supplied,
                        background: [
                          '#a8a0d8',
                          '#8abfb1',
                          '#ceaf81',
                          '#879db8',
                          '#acb782',
                          '#b994a6',
                        ][i % 6],
                      }}
                    />
                  ))}
              </div>
              <div className="exposure-list">
                {p.assets.map((a, i) => (
                  <div key={a.address}>
                    <span>
                      <i
                        style={{
                          background: [
                            '#a8a0d8',
                            '#8abfb1',
                            '#ceaf81',
                            '#879db8',
                            '#acb782',
                            '#b994a6',
                          ][i % 6],
                        }}
                      />
                      {a.symbol}
                    </span>
                    <span className="mono">{dollars(a.supplied)}</span>
                    <span className="mono muted">
                      {p.supplied
                        ? number((a.supplied / p.supplied) * 100, 1)
                        : '0'}
                      %
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="quiet-empty">
              <span className="empty-chart-lines" />
              <p>
                Asset allocation appears after your first saved observation.
              </p>
            </div>
          )}
        </section>
        <section>
          <div className="section-bar">
            <h2>Market pulse</h2>
            <button className="text-link" onClick={openMarkets}>
              All reserves <ArrowUpRight size={14} />
            </button>
          </div>
          {market ? (
            <div className="pulse-list">
              <div className="pulse-labels">
                <span>Asset</span>
                <span>Supplied</span>
                <span>Supply APR</span>
              </div>
              {market.reserves.slice(0, 5).map((a) => (
                <button key={a.address} onClick={openMarkets}>
                  <span>
                    <Token symbol={a.symbol} address={a.address} />
                    {a.symbol}
                  </span>
                  <span className="mono">{dollars(a.supplyUsd)}</span>
                  <span className="mono positive">{number(a.supplyApr)}%</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="quiet-empty">
              <p>Live reserve data will appear here when available.</p>
              <button className="text-link" onClick={openMarkets}>
                Open markets <ArrowUpRight size={14} />
              </button>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
