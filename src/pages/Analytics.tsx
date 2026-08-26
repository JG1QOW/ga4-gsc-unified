import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import BarChart from '../components/BarChart';
import ScatterChart from '../components/ScatterChart';
import {
  fetchReportCatalog,
  fetchSites,
  runReport,
  type ReportDefinition,
  type ReportResult,
  type SiteOption,
} from '../lib/api';
import { formatValue } from '../lib/format';
import { isComplete, loadSettings } from '../lib/settings';

function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultRange(): { startDate: string; endDate: string } {
  const end = new Date();
  end.setDate(end.getDate() - 3);
  const start = new Date(end);
  start.setDate(start.getDate() - 27);
  return { startDate: toDateInput(start), endDate: toDateInput(end) };
}

export default function Analytics() {
  const settings = useMemo(() => loadSettings(), []);
  const configured = isComplete(settings);
  const [range, setRange] = useState(defaultRange);
  const [catalog, setCatalog] = useState<ReportDefinition[]>([]);
  const [reportId, setReportId] = useState<string>('');
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [site, setSite] = useState('');
  const [threshold, setThreshold] = useState<number | null>(null);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedReport = catalog.find((report) => report.id === reportId) ?? null;
  const charts = selectedReport?.charts ?? [];
  const ga4Unmatched =
    result !== null &&
    result.rows.length > 0 &&
    result.columns.some((column) => column.key === 'sessions') &&
    result.rows.every((row) => row.sessions === null || row.sessions === undefined);

  useEffect(() => {
    fetchReportCatalog()
      .then(({ reports }) => {
        setCatalog(reports);
        setReportId((current) => current || reports[0]?.id || '');
      })
      .catch((cause: Error) => setError(cause.message));
  }, []);

  useEffect(() => {
    if (!configured) {
      return;
    }
    fetchSites(settings)
      .then(({ sites: available }) => setSites(available))
      .catch(() => setSites([]));
  }, [configured, settings]);

  useEffect(() => {
    setResult(null);
    setThreshold(null);
  }, [reportId]);

  const handleRun = async () => {
    if (!selectedReport) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const report = await runReport(selectedReport.id, {
        ...settings,
        startDate: range.startDate,
        endDate: range.endDate,
        site: site || null,
        threshold: threshold ?? selectedReport.defaultThreshold,
        limit: 100,
      });
      setResult(report);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  if (!configured) {
    return (
      <section className="card">
        <h2 className="card-title">Analytics</h2>
        <p className="card-text">
          BigQuery の接続先が未設定です。<Link to="/settings">Settings</Link> で Project / GA4 Dataset / GSC Dataset
          を保存してください。
        </p>
      </section>
    );
  }

  return (
    <div className="stack">
      <section className="card">
        <header className="card-header">
          <div>
            <h2 className="card-title">Analytics</h2>
            <p className="card-text">
              {settings.project} ／ GA4: {settings.ga4Dataset} ／ GSC: {settings.gscDataset}
            </p>
          </div>
        </header>

        <div className="report-grid">
          {catalog.map((report) => (
            <button
              key={report.id}
              type="button"
              className={report.id === reportId ? 'report-card is-active' : 'report-card'}
              onClick={() => setReportId(report.id)}
            >
              <span className="report-priority">{'★'.repeat(report.priority)}</span>
              <span className="report-name">{report.name}</span>
              <span className="report-source">{report.dataSource}</span>
              <span className="report-insight">{report.insight}</span>
            </button>
          ))}
        </div>

        <div className="filters">
          <label className="filter">
            <span className="filter-label">サイト</span>
            <select className="input" value={site} onChange={(event) => setSite(event.target.value)}>
              <option value="">すべて</option>
              {sites.map((option) => (
                <option key={option.siteUrl} value={option.siteUrl}>
                  {option.siteUrl}
                </option>
              ))}
            </select>
          </label>
          <label className="filter">
            <span className="filter-label">開始日</span>
            <input
              className="input"
              type="date"
              value={range.startDate}
              onChange={(event) => setRange((current) => ({ ...current, startDate: event.target.value }))}
            />
          </label>
          <label className="filter">
            <span className="filter-label">終了日</span>
            <input
              className="input"
              type="date"
              value={range.endDate}
              onChange={(event) => setRange((current) => ({ ...current, endDate: event.target.value }))}
            />
          </label>
          <label className="filter">
            <span className="filter-label">{selectedReport?.thresholdLabel ?? 'しきい値'}</span>
            <input
              className="input"
              type="number"
              min={0}
              value={threshold ?? selectedReport?.defaultThreshold ?? 0}
              onChange={(event) => setThreshold(Number(event.target.value))}
            />
          </label>
          <button className="button" type="button" onClick={handleRun} disabled={loading || !selectedReport}>
            {loading ? '実行中…' : 'レポート実行'}
          </button>
        </div>

        {error ? <p className="alert">{error}</p> : null}
      </section>

      {result && result.rows.length > 0 && charts.length > 0 ? (
        <section className="card">
          <header className="card-header">
            <div>
              <h3 className="card-title">{selectedReport?.name}（グラフ）</h3>
            </div>
          </header>
          <div className="chart-grid">
            {charts.map((chart, index) =>
              chart.type === 'bar' ? (
                <BarChart key={index} spec={chart} columns={result.columns} rows={result.rows} />
              ) : (
                <ScatterChart key={index} spec={chart} columns={result.columns} rows={result.rows} />
              ),
            )}
          </div>
        </section>
      ) : null}

      {result ? (
        <section className="card">
          <header className="card-header">
            <div>
              <h3 className="card-title">{selectedReport?.name}</h3>
              <p className="card-text">
                {result.rows.length} 行 ／ スキャン {(result.bytesProcessed / 1024 ** 2).toFixed(1)} MB
              </p>
            </div>
          </header>
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  {result.columns.map((column) => (
                    <th key={column.key} className={column.type === 'text' || column.type === 'url' ? '' : 'is-numeric'}>
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, index) => (
                  <tr key={index}>
                    {result.columns.map((column) => {
                      const value = row[column.key] ?? null;
                      const numeric = column.type !== 'text' && column.type !== 'url';
                      return (
                        <td key={column.key} className={numeric ? 'is-numeric' : ''}>
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
          {result.rows.length === 0 ? (
            <p className="card-text">
              条件に一致するページがありませんでした。しきい値を下げるか、期間を広げてください。
            </p>
          ) : null}
          {ga4Unmatched ? (
            <p className="alert">
              GSC のクリックに対応する GA4 のページが見つかりません。Settings の GA4 Dataset がこのサイトのプロパティか、
              選択したサイトとドメインが一致しているかを確認してください。
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
