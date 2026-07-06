'use client';
import { ExternalLink, LoaderCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { blockLink } from '@/lib/market';
export { api } from '@/lib/client-api';
export const short = (s: string) => s.slice(0, 6) + '…' + s.slice(-4);
export const number = (n: string | number, digits = 2) =>
  Number(n).toLocaleString('en-US', { maximumFractionDigits: digits });
export const dollars = (n: string | number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: Math.abs(Number(n)) >= 1e6 ? 'compact' : 'standard',
    maximumFractionDigits: 2,
  }).format(Number(n));
export const timestamp = (n: number) =>
  new Date(n).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
export const hf = (v: string | number | null) =>
  v === null ? 'No debt' : Number(v) > 999 ? '>999' : Number(v).toFixed(3);
export const healthTone = (v: string | number | null) =>
  v === null
    ? 'muted'
    : Number(v) < 1
      ? 'negative'
      : Number(v) < 1.5
        ? 'amber'
        : 'positive';
export function download(
  name: string,
  content: string,
  type = 'text/csv;charset=utf-8',
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function Token({
  symbol,
  address,
}: {
  symbol: string;
  address?: string;
}) {
  const colors = ['#a5a0e8', '#e1b97e', '#8fbcb5', '#a8b6d3', '#b2c092'];
  const i =
    (address ?? symbol).split('').reduce((a, b) => a + b.charCodeAt(0), 0) %
    colors.length;
  return (
    <span
      className="token-symbol"
      style={{
        color: colors[i],
        borderColor: colors[i] + '55',
        background: colors[i] + '12',
      }}
    >
      {symbol.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2)}
    </span>
  );
}
export function BlockStamp({
  block,
  time,
  stale = false,
}: {
  block: string;
  time: number;
  stale?: boolean;
}) {
  return (
    <div className="block-stamp">
      <span className={'status-dot ' + (stale ? 'warn' : '')} />
      {stale ? 'Last observation' : 'Observed'} {timestamp(time)}
      <a href={blockLink(block)} target="_blank" rel="noreferrer">
        #{number(block, 0)} <ExternalLink size={12} />
      </a>
    </div>
  );
}
export function Stat({
  label,
  value,
  sub,
  tone = '',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <strong className={tone}>{value}</strong>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}
export function Loading({ label = 'Reading Ink mainnet' }: { label?: string }) {
  return (
    <div className="loading-surface" aria-live="polite">
      <p>
        <LoaderCircle size={16} className="animate-spin" />
        {label}
      </p>
      {[1, 2, 3, 4].map((n) => (
        <Skeleton key={n} className="h-12 w-full rounded-sm" />
      ))}
    </div>
  );
}
export function EmptyState({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="empty-surface">
      <span className="empty-cross">＋</span>
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  );
}

export function AuthLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <a href={href} target="_top" className={className}>
      {children}
    </a>
  );
}
