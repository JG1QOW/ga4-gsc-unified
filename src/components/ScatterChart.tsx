import type { ReportColumn, ReportRow, ScatterChartSpec } from '../lib/api';
import { formatValue, shortLabel, toNumber } from '../lib/format';

const WIDTH = 640;
const HEIGHT = 320;
const PADDING = { top: 16, right: 16, bottom: 40, left: 64 };

type Point = { x: number; y: number; label: string | number | null };

function scale(value: number, min: number, max: number, from: number, to: number): number {
  if (max === min) {
    return (from + to) / 2;
  }
  return from + ((value - min) / (max - min)) * (to - from);
}

type Props = {
  spec: ScatterChartSpec;
  columns: ReportColumn[];
  rows: ReportRow[];
};

export default function ScatterChart({ spec, columns, rows }: Props) {
  const xColumn = columns.find((column) => column.key === spec.xKey);
  const yColumn = columns.find((column) => column.key === spec.yKey);
  const points: Point[] = rows
    .map((row) => ({ x: toNumber(row[spec.xKey]), y: toNumber(row[spec.yKey]), label: row[spec.labelKey] }))
    .filter((point): point is Point => point.x !== null && point.y !== null);

  if (points.length === 0) {
    return null;
  }

  const xValues = points.map((point) => point.x);
  const yValues = points.map((point) => point.y);
  const xMin = Math.min(...xValues, 0);
  const xMax = Math.max(...xValues);
  const yMin = Math.min(...yValues, 0);
  const yMax = Math.max(...yValues);
  const plotLeft = PADDING.left;
  const plotRight = WIDTH - PADDING.right;
  const plotTop = PADDING.top;
  const plotBottom = HEIGHT - PADDING.bottom;
  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  return (
    <figure className="chart">
      <figcaption className="chart-title">{spec.title}</figcaption>
      <svg className="scatter-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img">
        {gridLines.map((ratio) => {
          const y = plotBottom - ratio * (plotBottom - plotTop);
          const value = yMin + ratio * (yMax - yMin);
          return (
            <g key={ratio}>
              <line className="chart-grid" x1={plotLeft} x2={plotRight} y1={y} y2={y} />
              <text className="chart-tick" x={plotLeft - 8} y={y + 4} textAnchor="end">
                {formatValue(value, yColumn)}
              </text>
            </g>
          );
        })}
        {gridLines.map((ratio) => {
          const x = plotLeft + ratio * (plotRight - plotLeft);
          const value = xMin + ratio * (xMax - xMin);
          return (
            <text className="chart-tick" key={`x-${ratio}`} x={x} y={plotBottom + 20} textAnchor="middle">
              {formatValue(value, xColumn)}
            </text>
          );
        })}
        {points.map((point, index) => (
          <circle
            className="chart-point"
            key={index}
            cx={scale(point.x, xMin, xMax, plotLeft, plotRight)}
            cy={scale(point.y, yMin, yMax, plotBottom, plotTop)}
            r={5}
          >
            <title>
              {`${shortLabel(point.label)}\n${xColumn?.label ?? spec.xKey}: ${formatValue(point.x, xColumn)}\n${
                yColumn?.label ?? spec.yKey
              }: ${formatValue(point.y, yColumn)}`}
            </title>
          </circle>
        ))}
      </svg>
      <p className="chart-axis">
        横軸: {xColumn?.label ?? spec.xKey} ／ 縦軸: {yColumn?.label ?? spec.yKey}
      </p>
    </figure>
  );
}
