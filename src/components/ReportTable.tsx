import { useMemo, useState } from 'react';
import type { ReportColumn, ReportRow } from '../lib/api';
import { formatValue, toNumber } from '../lib/format';

type SortDirection = 'asc' | 'desc';

type SortState = {
  key: string;
  direction: SortDirection;
};

function isNumericColumn(column: ReportColumn): boolean {
  return column.type !== 'text' && column.type !== 'url';
}

function compare(a: string | number | null, b: string | number | null, column: ReportColumn): number {
  const missingA = a === null || a === undefined || a === '';
  const missingB = b === null || b === undefined || b === '';
  if (missingA || missingB) {
    return missingA && missingB ? 0 : missingA ? 1 : -1;
  }
  if (isNumericColumn(column)) {
    return (toNumber(a) ?? 0) - (toNumber(b) ?? 0);
  }
  return String(a).localeCompare(String(b), 'ja');
}

type Props = {
  columns: ReportColumn[];
  rows: ReportRow[];
};

export default function ReportTable({ columns, rows }: Props) {
  const [sort, setSort] = useState<SortState | null>(null);

  const sortedRows = useMemo(() => {
    if (!sort) {
      return rows;
    }
    const column = columns.find((candidate) => candidate.key === sort.key);
    if (!column) {
      return rows;
    }
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => factor * compare(a[column.key] ?? null, b[column.key] ?? null, column));
  }, [columns, rows, sort]);

  const toggleSort = (column: ReportColumn) => {
    setSort((current) => {
      if (current?.key !== column.key) {
        return { key: column.key, direction: isNumericColumn(column) ? 'desc' : 'asc' };
      }
      return { key: column.key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
    });
  };

  return (
    <div className="table-wrapper">
      <table className="table">
        <thead>
          <tr>
            {columns.map((column) => {
              const active = sort?.key === column.key;
              return (
                <th
                  key={column.key}
                  className={isNumericColumn(column) ? 'is-numeric' : ''}
                  aria-sort={active ? (sort?.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <button
                    type="button"
                    className={active ? 'table-sort is-active' : 'table-sort'}
                    onClick={() => toggleSort(column)}
                  >
                    <span>{column.label}</span>
                    <span className="table-sort-icon">{active ? (sort?.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => {
                const value = row[column.key] ?? null;
                return (
                  <td key={column.key} className={isNumericColumn(column) ? 'is-numeric' : ''}>
                    {column.type === 'url' && typeof value === 'string' ? (
                      <a href={value} target="_blank" rel="noreferrer">
                        {value}
                      </a>
                    ) : (
                      formatValue(value, column)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
