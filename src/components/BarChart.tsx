import type { BarChartSpec, ReportColumn, ReportRow } from '../lib/api';
import { formatValue, shortLabel, toNumber } from '../lib/format';

const MAX_BARS = 15;

type Props = {
  spec: BarChartSpec;
  columns: ReportColumn[];
  rows: ReportRow[];
};

export default function BarChart({ spec, columns, rows }: Props) {
  const valueColumn = columns.find((column) => column.key === spec.valueKey);
  const bars = rows
    .map((row) => ({ label: row[spec.labelKey], value: toNumber(row[spec.valueKey]) }))
    .filter((bar): bar is { label: string | number | null; value: number } => bar.value !== null)
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_BARS);

  if (bars.length === 0) {
    return null;
  }

  const max = Math.max(...bars.map((bar) => bar.value));

  return (
    <figure className="chart">
      <figcaption className="chart-title">{spec.title}</figcaption>
      <div className="bar-chart">
        {bars.map((bar, index) => (
          <div className="bar-row" key={index}>
            <span className="bar-label" title={String(bar.label ?? '')}>
              {shortLabel(bar.label)}
            </span>
            <span className="bar-track">
              <span className="bar-fill" style={{ width: `${max > 0 ? (bar.value / max) * 100 : 0}%` }} />
            </span>
            <span className="bar-value">{formatValue(bar.value, valueColumn)}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}
