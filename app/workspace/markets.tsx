'use client';
import { useState } from 'react';
import { ArrowDownUp, ArrowUpRight, Search, X } from 'lucide-react';
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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { addressLink } from '@/lib/market';
import type { MarketSnapshot, ReserveMarket } from '@/lib/types';
import {
  BlockStamp,
  dollars,
  EmptyState,
  Loading,
  number,
  Stat,
  Token,
} from './shared';
type Sort = 'supply' | 'borrow' | 'supplyRate' | 'utilization';
const sorts: Record<Sort, string> = {
  supply: 'Total supply',
  borrow: 'Total debt',
  supplyRate: 'Supply APR',
  utilization: 'Utilization',
};
export function Markets({
  market,
  loading,
  error,
  reload,
  now,
}: {
  market: MarketSnapshot | null;
  loading: boolean;
  error: string;
  reload: () => void;
  now: number;
}) {
  const [search, setSearch] = useState(''),
    [sort, setSort] = useState<Sort>('supply'),
    [selected, setSelected] = useState<string | null>(null);
  const reserves = market?.reserves ?? [];
  const rows = reserves
    .filter((r) =>
      (r.symbol + r.address).toLowerCase().includes(search.toLowerCase()),
    )
    .sort(
      (a, b) =>
        ({
          supply: Number(b.supplyUsd) - Number(a.supplyUsd),
          borrow: Number(b.debtUsd) - Number(a.debtUsd),
          supplyRate: b.supplyApr - a.supplyApr,
          utilization: b.utilization - a.utilization,
        })[sort],
    );
  const asset = reserves.find((r) => r.address === selected);
  if (!market && loading)
    return <Loading label="Reading reserve balances and rates" />;
  if (!market)
    return (
      <EmptyState title="Market data is unavailable">
        <p>{error}</p>
        <Button onClick={reload}>Retry market read</Button>
      </EmptyState>
    );
  return (
    <>
      <div className="section-intro">
        <div>
          <div className="eyebrow">Tydro V3 / Ink mainnet</div>
          <h1>
            Lending markets
            <span className="title-count">{reserves.length}</span>
          </h1>
          <p>
            Liquidity, rates, and reserve parameters. Direct from the protocol.
          </p>
        </div>
        <a
          className="text-link"
          href="https://app.tydro.com/"
          target="_blank"
          rel="noreferrer"
        >
          Open Tydro <ArrowUpRight size={16} />
        </a>
      </div>
      <div className="stat-strip">
        <Stat
          label="Total supplied"
          value={dollars(reserves.reduce((s, r) => s + Number(r.supplyUsd), 0))}
          sub="Outstanding aToken balances"
        />
        <Stat
          label="Total borrowed"
          value={dollars(reserves.reduce((s, r) => s + Number(r.debtUsd), 0))}
          sub="Stable + variable debt"
        />
        <Stat
          label="Available liquidity"
          value={dollars(
            reserves.reduce((s, r) => s + Number(r.liquidityUsd), 0),
          )}
          sub="Protocol virtual balances"
        />
        <Stat
          label="Active reserves"
          value={String(
            reserves.filter((r) => r.active && !r.paused).length,
          ).padStart(2, '0')}
          sub="Current reserve configuration"
        />
      </div>
      {error && (
        <p className="inline-warning">
          Refresh failed. Showing the previous read. {error}
        </p>
      )}
      <div className="table-toolbar">
        <div className="filter-input">
          <Search size={15} />
          <Input
            aria-label="Search markets"
            placeholder="Find asset or contract"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={sort} onValueChange={(v) => v && setSort(v as Sort)}>
          <SelectTrigger aria-label="Sort markets">
            <ArrowDownUp size={14} />
            <SelectValue>{sorts[sort]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(sorts).map(([id, label]) => (
              <SelectItem key={id} value={id}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="market-layout">
        <div className="data-table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset</TableHead>
                <TableHead className="numeric">Price</TableHead>
                <TableHead className="numeric">Supplied</TableHead>
                <TableHead className="numeric">Supply APR</TableHead>
                <TableHead className="numeric">Borrow APR</TableHead>
                <TableHead className="numeric">Utilization</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.address}
                  data-selected={selected === r.address}
                >
                  <TableCell>
                    <button
                      className="asset-button"
                      onClick={() =>
                        setSelected(selected === r.address ? null : r.address)
                      }
                      aria-expanded={selected === r.address}
                    >
                      <Token symbol={r.symbol} address={r.address} />
                      <span>
                        {r.symbol}
                        <small>
                          {r.collateralEnabled
                            ? 'Collateral eligible'
                            : 'Supply only'}
                        </small>
                      </span>
                      <ArrowUpRight size={14} />
                    </button>
                  </TableCell>
                  <TableCell className="numeric">
                    {dollars(r.priceUsd)}
                  </TableCell>
                  <TableCell className="numeric">
                    {dollars(r.supplyUsd)}
                  </TableCell>
                  <TableCell className="numeric positive">
                    {number(r.supplyApr)}%
                  </TableCell>
                  <TableCell className="numeric">
                    {r.borrowingEnabled ? number(r.borrowApr) + '%' : '—'}
                  </TableCell>
                  <TableCell className="numeric">
                    <span>{number(r.utilization, 1)}%</span>
                    <span className="mini-bar">
                      <i
                        style={{ width: Math.min(100, r.utilization) + '%' }}
                      />
                    </span>
                  </TableCell>
                  <TableCell>
                    <span
                      className={
                        'status-label ' +
                        (r.paused || r.frozen || !r.active ? 'amber' : '')
                      }
                    >
                      {r.paused
                        ? 'Paused'
                        : !r.active
                          ? 'Inactive'
                          : r.frozen
                            ? 'Frozen'
                            : 'Active'}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {asset && (
          <ReserveDetail asset={asset} close={() => setSelected(null)} />
        )}
      </div>
      {!rows.length && (
        <p className="table-empty">No assets match “{search}”.</p>
      )}
      <div className="table-foot">
        <span>
          APR is a variable pool rate. Incentives and underlying-token yields
          are excluded.
        </span>
        <BlockStamp
          block={market.blockNumber}
          time={market.observedAt}
          stale={now - market.observedAt > 180_000 || !!error}
        />
      </div>
    </>
  );
}
function ReserveDetail({
  asset: a,
  close,
}: {
  asset: ReserveMarket;
  close: () => void;
}) {
  return (
    <aside className="reserve-detail">
      <div className="panel-heading">
        <div className="asset-title">
          <Token symbol={a.symbol} address={a.address} />
          <h2>{a.symbol}</h2>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close asset details"
          onClick={close}
        >
          <X />
        </Button>
      </div>
      <dl className="key-values">
        <dt>Available liquidity</dt>
        <dd>{dollars(a.liquidityUsd)}</dd>
        <dt>Total debt</dt>
        <dd>{dollars(a.debtUsd)}</dd>
        <dt>Base max LTV</dt>
        <dd>{number(a.ltvBps / 100)}%</dd>
        <dt>Base liquidation threshold</dt>
        <dd>{number(a.liquidationThresholdBps / 100)}%</dd>
        <dt>Liquidation bonus</dt>
        <dd>{number(Math.max(0, a.liquidationBonusBps - 10_000) / 100)}%</dd>
        <dt>Reserve factor</dt>
        <dd>{number(a.reserveFactorBps / 100)}%</dd>
      </dl>
      <Cap
        label="Supply cap"
        current={a.supplied}
        max={a.supplyCap}
        symbol={a.symbol}
      />
      <Cap
        label="Borrow cap"
        current={a.borrowed}
        max={a.borrowCap}
        symbol={a.symbol}
      />
      <p className="small-note">
        Base parameters are shown. A position’s efficiency mode can apply
        different collateral parameters.
      </p>
      <a
        className="text-link"
        href={addressLink(a.address)}
        target="_blank"
        rel="noreferrer"
      >
        Token contract <ArrowUpRight size={14} />
      </a>
    </aside>
  );
}
function Cap({
  label,
  current,
  max,
  symbol,
}: {
  label: string;
  current: string;
  max: string;
  symbol: string;
}) {
  return (
    <div className="cap">
      <div>
        <span>{label}</span>
        <strong>
          {Number(max)
            ? number((Number(current) / Number(max)) * 100, 1) + '% used'
            : 'No cap'}
        </strong>
      </div>
      {Number(max) > 0 && (
        <>
          <span className="mini-bar">
            <i
              style={{
                width:
                  Math.min(100, (Number(current) / Number(max)) * 100) + '%',
              }}
            />
          </span>
          <small>
            {number(current, 0)} / {number(max, 0)} {symbol}
          </small>
        </>
      )}
    </div>
  );
}
