'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Download, LoaderCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import { MARKET } from '@/lib/market';
import { csv } from '@/lib/analytics';
import type { ActivityPage } from '@/lib/types';
import {
  api,
  download,
  EmptyState,
  Loading,
  number,
  short,
  timestamp,
} from './shared';
export function ActivityFeed({
  address,
  verify,
}: {
  address: string;
  verify: (block: string) => void;
}) {
  const [pages, setPages] = useState<ActivityPage[]>([]),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [filter, setFilter] = useState('All');
  const seq = useRef(0),
    pending = useRef(false),
    active = useRef(true);
  const load = useCallback(
    async (before?: string) => {
      if (pending.current) return;
      pending.current = true;
      const current = ++seq.current;
      setBusy(true);
      setError('');
      try {
        const page = await api<ActivityPage>(
          '/api/activity?address=' +
            encodeURIComponent(address) +
            (before ? '&before=' + before : ''),
        );
        if (current === seq.current && active.current)
          setPages((p) => (before ? [...p, page] : [page]));
      } catch (e) {
        if (current === seq.current && active.current)
          setError((e as Error).message);
      } finally {
        if (current === seq.current && active.current) {
          pending.current = false;
          setBusy(false);
        }
      }
    },
    [address],
  );
  useEffect(() => {
    active.current = true;
    const timer = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(timer);
      active.current = false;
    };
  }, [load]);
  const events = pages.flatMap((p) => p.events),
    rows = events.filter((e) => filter === 'All' || e.kind === filter);
  const last = pages.at(-1),
    first = pages[0];
  return (
    <>
      <div className="section-intro">
        <div>
          <div className="eyebrow">Activity / Protocol events</div>
          <h1>On-chain activity</h1>
          <p>
            Decoded Tydro pool events for{' '}
            <span className="mono">{short(address)}</span>.
          </p>
        </div>
        <Button variant="outline" disabled={busy} onClick={() => void load()}>
          <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
          Latest events
        </Button>
      </div>
      <div className="activity-scope">
        <span className="tag">Pool events only</span>
        <p>
          Supply, withdrawal, borrowing, repayment, collateral settings,
          efficiency mode, and liquidation. Pages scan up to 2,000 blocks;
          aToken transfers and other protocols are excluded.
        </p>
      </div>
      {error && (
        <p role="alert" className="inline-warning">
          {error}{' '}
          <button
            className="text-link"
            disabled={busy}
            onClick={() => void load(last?.nextBefore ?? undefined)}
          >
            Retry
          </button>
        </p>
      )}
      {!pages.length && busy ? (
        <Loading label="Scanning recent protocol events" />
      ) : (
        <>
          <div className="table-toolbar">
            <div className="segmented-control activity-filters">
              {[
                'All',
                'Supply',
                'Borrow',
                'Repay',
                'Withdraw',
                'Liquidation',
              ].map((kind) => (
                <button
                  key={kind}
                  onClick={() => setFilter(kind)}
                  aria-pressed={filter === kind}
                >
                  {kind}
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={!events.length}
              onClick={() =>
                download(
                  'optics-activity.csv',
                  csv([
                    [
                      'Event',
                      'Asset',
                      'Amount',
                      'Time',
                      'Block',
                      'Transaction',
                      'Detail',
                    ],
                    ...events.map((e) => [
                      e.kind,
                      e.symbol,
                      e.amount,
                      new Date(e.timestamp).toISOString(),
                      e.blockNumber,
                      e.transactionHash,
                      e.detail,
                    ]),
                  ]),
                )
              }
            >
              <Download size={14} />
              Export
            </Button>
          </div>
          {rows.length ? (
            <div className="data-table">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead>Asset</TableHead>
                    <TableHead className="numeric">Amount</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead className="numeric">Block</TableHead>
                    <TableHead>Transaction</TableHead>
                    <TableHead>Receipt evidence</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>
                        <strong
                          className={e.kind === 'Liquidation' ? 'negative' : ''}
                        >
                          {e.kind}
                        </strong>
                        {e.detail && (
                          <small className="cell-note event-detail">
                            {e.detail}
                          </small>
                        )}
                      </TableCell>
                      <TableCell>{e.symbol}</TableCell>
                      <TableCell className="numeric">
                        {e.amount === null ? '—' : number(e.amount, 8)}
                      </TableCell>
                      <TableCell className="mono time-cell">
                        {timestamp(e.timestamp)}
                      </TableCell>
                      <TableCell className="numeric">
                        {number(e.blockNumber, 0)}
                      </TableCell>
                      <TableCell>
                        <a
                          className="text-link mono"
                          href={MARKET.explorer + '/tx/' + e.transactionHash}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {short(e.transactionHash)}
                          <ArrowUpRight size={13} />
                        </a>
                      </TableCell>
                      <TableCell>
                        <button
                          className="text-link"
                          onClick={() => verify(e.blockNumber)}
                        >
                          Verify block
                        </button>
                        <small className="cell-note">
                          Receipt audit
                        </small>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <EmptyState
              title={
                events.length
                  ? 'No events match this filter'
                  : 'No supported events in the scanned range'
              }
            >
              <p>
                Load an earlier block range to look further back. This does not
                mean the address has no historical activity.
              </p>
            </EmptyState>
          )}
          {first && last && (
            <div className="activity-pagination">
              <div>
                <span>
                  Scanned {timestamp(last.fromTimestamp)} —{' '}
                  {timestamp(first.toTimestamp)}
                </span>
                <small className="mono">
                  Blocks {number(last.fromBlock, 0)}–{number(first.toBlock, 0)}{' '}
                  · {events.length} events
                </small>
              </div>
              <Button
                variant="outline"
                disabled={busy || !last.nextBefore}
                onClick={() => void load(last.nextBefore!)}
              >
                {busy && <LoaderCircle size={14} className="animate-spin" />}
                {last.nextBefore
                  ? 'Load earlier blocks'
                  : 'Beginning of chain reached'}
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
