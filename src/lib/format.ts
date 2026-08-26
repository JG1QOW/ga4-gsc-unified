import type { ReportColumn } from './api';

export function formatValue(value: string | number | null, column: ReportColumn | undefined): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  if (!column) {
    return String(value);
  }
  if (column.type === 'number') {
    return Number(value).toLocaleString('ja-JP');
  }
  if (column.type === 'decimal') {
    return Number(value).toLocaleString('ja-JP', { maximumFractionDigits: 1 });
  }
  if (column.type === 'percent') {
    return `${(Number(value) * 100).toFixed(1)}%`;
  }
  return String(value);
}

export function shortLabel(value: string | number | null): string {
  if (value === null || value === undefined) {
    return '—';
  }
  const text = String(value);
  const withoutOrigin = text.replace(/^https?:\/\//, '');
  return withoutOrigin.length > 48 ? `${withoutOrigin.slice(0, 47)}…` : withoutOrigin;
}

export function toNumber(value: string | number | null): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
