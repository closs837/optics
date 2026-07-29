'use client';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import {
  ArrowUpRight,
  Download,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { MARKET } from '@/lib/market';
import type { VerificationWorkspace } from '@/lib/verification/types';
import {
  api,
  download,
  EmptyState,
  Loading,
  number,
  short,
  timestamp,
} from './shared';

export function VerifiedActivity({
  signedIn,
  initialBlock,
  address,
}: {
  signedIn: boolean;
  initialBlock?: string;
  address?: string;
}) {
  const [workspace, setWorkspace] = useState<VerificationWorkspace | null>(
    null,
  );
  const [block, setBlock] = useState(initialBlock ?? 'finalized');
  const [loading, setLoading] = useState(signedIn);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const [filter, setFilter] = useState('all');
  const [confirmClear, setConfirmClear] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setWorkspace(await api<VerificationWorkspace>('/api/verification'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!signedIn) return;
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [signedIn, load]);
  async function run(action: 'live' | 'capture' | 'retry' | 'clear') {
    if (busy) return;
    setBusy(action);
    setError('');
    try {
      const next = await api<VerificationWorkspace>(
        '/api/verification',
        action === 'clear' ? 'DELETE' : 'POST',
        action === 'clear' ? {} : { action, blockNumber: block },
      );
      setWorkspace(next);
      setSelected(next.ledger.runs.at(-1)?.id ?? '');
      setConfirmClear(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void run('live');
  }
  const ledger = workspace?.ledger;
  const runs = ledger?.runs ?? [];
  const current = runs.find((item) => item.id === selected) ?? runs.at(-1);
  const events = (ledger?.events ?? []).filter(
    (event) =>
      filter === 'all' ||
      (filter === 'pool'
        ? event.address.toLowerCase() === MARKET.pool.toLowerCase()
        : !!address &&
          (event.address.toLowerCase() === address.toLowerCase() ||
            event.topics.some(
              (topic) =>
                topic.toLowerCase() ===
                '0x' + address.slice(2).toLowerCase().padStart(64, '0'),
            ))),
  );
  const accepted = runs.filter((item) => item.status === 'verified').length;
  return (
    <>
      <div className="section-intro verification-intro">
        <div>
          <div className="eyebrow">Activity / Receipt evidence</div>
          <h1>Verified activity</h1>
          <p>
            Check Ink block receipts, retain the evidence, and inspect the
            resulting event index.
          </p>
        </div>
        <span className="tag verification-label">
          <ShieldCheck size={13} /> Receipt audit
        </span>
      </div>
      <div className="verification-disclosure" role="note">
        <strong>Receipt evidence and RPC finality</strong>
        <p>
          Receipt checks use the supplied block headers and RPC view. Live
          reads use Ink mainnet; recorded blocks preserve their capture
          provenance. No wallet or transaction signing is involved.
        </p>
      </div>
      {!signedIn ? (
        <EmptyState title="Sign in to save verification evidence">
          <p>
            Use Sign in in the workspace sidebar. Your receipt evidence and
            retry state are saved to your account.
          </p>
        </EmptyState>
      ) : (
        <>
          <form className="verification-controls" onSubmit={submit}>
            <div>
              <Label htmlFor="verification-block">Ink block</Label>
              <Input
                id="verification-block"
                value={block}
                onChange={(e) => setBlock(e.target.value)}
                placeholder="Block number or finalized"
                maxLength={12}
                required
                spellCheck={false}
              />
            </div>
            <Button type="submit" disabled={!!busy || loading}>
              {busy === 'live' && (
                <LoaderCircle size={14} className="animate-spin" />
              )}{' '}
              Verify live block
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!!busy || loading}
              onClick={() => void run('capture')}
            >
              {busy === 'capture' && (
                <LoaderCircle size={14} className="animate-spin" />
              )}{' '}
              Replay Ink capture
            </Button>
          </form>
          <p className="verification-footnote">
            Live verification uses both official RPC providers. Receipt
            inclusion is checked against the returned block header; canonical
            status relies on the RPC view. This is not a light client.
          </p>
          {error && (
            <p className="inline-warning" role="alert">
              {error}{' '}
              <button
                className="text-link"
                disabled={!!busy}
                onClick={() => void load()}
              >
                Reload saved evidence
              </button>
            </p>
          )}
          {loading ? (
            <Loading label="Loading saved receipt evidence" />
          ) : (
            <>
              <div className="verification-summary" aria-live="polite">
                <div>
                  <span>Evidence blocks</span>
                  <strong>
                    {runs.length}
                    <small> / 8</small>
                  </strong>
                </div>
                <div>
                  <span>Reported accepted</span>
                  <strong>{accepted}</strong>
                </div>
                <div>
                  <span>Verification failed</span>
                  <strong className={runs.length > accepted ? 'negative' : ''}>
                    {runs.length - accepted}
                  </strong>
                </div>
                <div>
                  <span>Indexed logs</span>
                  <strong>{ledger?.events.length ?? 0}</strong>
                </div>
              </div>
              <div className="table-toolbar">
                <div>
                  <strong>Saved evidence</strong>
                  <small className="cell-note">
                    {workspace?.updatedAt
                      ? 'Saved ' +
                        timestamp(workspace.updatedAt) +
                        ' · revision ' +
                        workspace.version
                      : 'No saved blocks yet'}
                  </small>
                </div>
                <div className="verification-actions">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!!busy || !runs.length}
                    onClick={() => void run('retry')}
                  >
                    <RotateCcw
                      size={13}
                      className={busy === 'retry' ? 'animate-spin' : ''}
                    />{' '}
                    Retry saved evidence
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!runs.length || !!busy}
                    onClick={() =>
                      download(
                        'optics-verified-evidence.json',
                        JSON.stringify(workspace, null, 2),
                        'application/json',
                      )
                    }
                  >
                    <Download size={13} /> Export evidence
                  </Button>
                </div>
              </div>
              {!runs.length ? (
                <EmptyState title="Start with a block or the Ink capture">
                  <p>
                    You can also open a transaction from On-chain activity and
                    select Verify block. Evidence remains available after a
                    refresh or server restart.
                  </p>
                </EmptyState>
              ) : (
                <div className="data-table">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Block</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Receipt check</TableHead>
                        <TableHead>Reported finality</TableHead>
                        <TableHead className="numeric">Receipts</TableHead>
                        <TableHead className="numeric">Attempts</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...runs].reverse().map((item) => (
                        <TableRow
                          key={item.id}
                          data-state={
                            current?.id === item.id ? 'selected' : undefined
                          }
                        >
                          <TableCell>
                            <button
                              className="text-link mono"
                              onClick={() => setSelected(item.id)}
                              aria-label={'Inspect block ' + item.blockNumber}
                            >
                              {number(item.blockNumber, 0)}
                            </button>
                            <small className="cell-note mono">
                              {short(item.id)}
                            </small>
                          </TableCell>
                          <TableCell>
                            {item.source === 'live'
                              ? 'Live RPC'
                              : item.source === 'capture'
                                ? 'Ink capture'
                                : 'Replay set'}
                            <small className="cell-note">
                              {timestamp(Date.parse(item.capturedAt))}
                            </small>
                          </TableCell>
                          <TableCell>
                            <span
                              className={
                                item.status === 'rejected'
                                  ? 'negative'
                                  : 'positive'
                              }
                            >
                              {item.status === 'rejected'
                                ? 'Failed'
                                : 'Accepted'}
                            </span>
                            {item.cacheHit && (
                              <small className="cell-note">
                                Saved computation
                              </small>
                            )}
                          </TableCell>
                          <TableCell>{item.finality}</TableCell>
                          <TableCell className="numeric">
                            {item.receipts}
                          </TableCell>
                          <TableCell className="numeric">
                            {item.attempts}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {current && (
                <section
                  className="verification-evidence"
                  aria-label="Selected receipt evidence"
                >
                  <div className="panel-heading">
                    <strong>Block {number(current.blockNumber, 0)}</strong>
                    <a
                      className="text-link"
                      href={MARKET.explorer + '/block/' + current.id}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Explorer <ArrowUpRight size={13} />
                    </a>
                  </div>
                  <output
                    className={
                      current.status === 'rejected' ? 'negative' : 'muted'
                    }
                  >
                    {current.message}
                  </output>
                  <dl>
                    <div>
                      <dt>Header receipt root</dt>
                      <dd>{current.expectedRoot}</dd>
                    </div>
                    <div>
                      <dt>Computed receipt root</dt>
                      <dd>{current.observedRoot}</dd>
                    </div>
                    <div>
                      <dt>Block hash</dt>
                      <dd>{current.id}</dd>
                    </div>
                  </dl>
                  <small className="muted">
                    {current.sourceLabel} · Captured{' '}
                    {new Date(current.capturedAt).toISOString()}
                  </small>
                </section>
              )}
              <div className="table-toolbar">
                <strong>Event index</strong>
                <div className="segmented-control">
                  {[
                    ['all', 'All contracts'],
                    ['pool', 'Tydro pool'],
                    ...(address ? [['address', 'Selected address']] : []),
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      aria-pressed={filter === value}
                      onClick={() => setFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {events.length ? (
                <div className="data-table">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Contract</TableHead>
                        <TableHead>Transaction</TableHead>
                        <TableHead className="numeric">Log</TableHead>
                        <TableHead>Reported finality</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {events.slice(0, 200).map((event, index) => (
                        <TableRow key={event.id + ':' + index}>
                          <TableCell className="mono">
                            {short(event.address)}
                            {event.address.toLowerCase() ===
                              MARKET.pool.toLowerCase() && (
                              <small className="cell-note">Tydro pool</small>
                            )}
                          </TableCell>
                          <TableCell>
                            <a
                              className="text-link mono"
                              href={
                                MARKET.explorer + '/tx/' + event.transactionHash
                              }
                              target="_blank"
                              rel="noreferrer"
                            >
                              {short(event.transactionHash)}{' '}
                              <ArrowUpRight size={12} />
                            </a>
                          </TableCell>
                          <TableCell className="numeric">
                            {event.logIndex}
                          </TableCell>
                          <TableCell>{event.finality}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {events.length > 200 && (
                    <p className="verification-footnote">
                      Showing 200 of {events.length} logs. Export evidence for
                      the full index.
                    </p>
                  )}
                </div>
              ) : (
                <div className="verification-empty">
                  No indexed logs for this scope. Inspect the receipt checks
                  above.
                </div>
              )}
              {!!runs.length && (
                <div className="verification-clear">
                  {!confirmClear ? (
                    <button
                      className="text-link muted"
                      onClick={() => setConfirmClear(true)}
                    >
                      Clear saved evidence
                    </button>
                  ) : (
                    <>
                      <span>
                        This removes your saved verification evidence. Export it
                        first if needed.
                      </span>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={!!busy}
                        onClick={() => void run('clear')}
                      >
                        Clear evidence
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmClear(false)}
                      >
                        Cancel
                      </Button>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
