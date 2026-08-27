import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import BarChart from '../components/BarChart';
import ReportTable from '../components/ReportTable';
import ScatterChart from '../components/ScatterChart';
import {
  fetchReportCatalog,
  fetchSites,
  runReport,
  type ReportDefinition,
  type ReportResult,
  type SiteOption,
} from '../lib/api';
import { activeSite, isComplete, loadStore, saveActiveSiteId, siteLabel } from '../lib/settings';
import { resolveUnits } from '../lib/units';

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
  const store = useMemo(() => loadStore(), []);
  const [siteConfigId, setSiteConfigId] = useState<string>(() => activeSite(store)?.id ?? '');
  const settings = store.sites.find((site) => site.id === siteConfigId) ?? null;
  const configured = settings !== null && isComplete(settings);

  const [range, setRange] = useState(defaultRange);
  const [catalog, setCatalog] = useState<ReportDefinition[]>([]);
  const [unitId, setUnitId] = useState<string>('');
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [site, setSite] = useState('');
  const [threshold, setThreshold] = useState<number | null>(null);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const units = useMemo(() => (settings ? resolveUnits(settings, catalog) : []), [settings, catalog]);
  const selectedUnit = units.find((entry) => entry.unit.id === unitId) ?? units[0] ?? null;
  const selectedReport = selectedUnit?.report ?? null;
  const charts = selectedReport?.charts ?? [];
  const ga4Unmatched =
    result !== null &&
    result.rows.length > 0 &&
    result.columns.some((column) => column.key === 'sessions') &&
    result.rows.every((row) => row.sessions === null || row.sessions === undefined);

  useEffect(() => {
    fetchReportCatalog()
      .then(({ reports }) => setCatalog(reports))
      .catch((cause: Error) => setError(cause.message));
  }, []);

  useEffect(() => {
    if (!configured || !settings) {
      return;
    }
    fetchSites(settings)
      .then(({ sites: available }) => setSites(available))
      .catch(() => setSites([]));
  }, [configured, settings]);

  useEffect(() => {
    setResult(null);
    setThreshold(null);
  }, [unitId]);

  useEffect(() => {
    setResult(null);
    setUnitId('');
    setSite('');
    setSites([]);
    if (siteConfigId) {
      saveActiveSiteId(siteConfigId);
    }
  }, [siteConfigId]);

  const handleRun = async () => {
    if (!selectedUnit || !settings) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const report = await runReport(selectedUnit.report.id, {
        project: settings.project,
        ga4Dataset: settings.ga4Dataset,
        gscDataset: settings.gscDataset,
        startDate: range.startDate,
        endDate: range.endDate,
        site: site || null,
        threshold: threshold ?? selectedUnit.unit.threshold ?? selectedUnit.report.defaultThreshold,
        limit: selectedUnit.unit.limit,
      });
      setResult(report);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  if (!configured || !settings) {
    return (
      <section className="card">
        <h2 className="card-title">Analytics</h2>
        <p className="card-text">
          BigQuery の接続先が未設定です。<Link to="/settings">Settings</Link> でサイト（Project / GA4 Dataset / GSC
          Dataset）を保存してください。
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
          {store.sites.length > 1 ? (
            <label className="filter">
              <span className="filter-label">登録サイト</span>
              <select
                className="input"
                value={siteConfigId}
                onChange={(event) => setSiteConfigId(event.target.value)}
              >
                {store.sites.map((option) => (
                  <option key={option.id} value={option.id}>
                    {siteLabel(option)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </header>

        {units.length === 0 ? (
          <p className="card-text">
            このサイトのレポートユニットが構成されていません。<Link to="/settings">Settings</Link> で構成してください。
          </p>
        ) : (
          <div className="report-grid">
            {units.map(({ unit, report, label }) => (
              <button
                key={unit.id}
                type="button"
                className={unit.id === selectedUnit?.unit.id ? 'report-card is-active' : 'report-card'}
                onClick={() => setUnitId(unit.id)}
              >
                <span className="report-priority">{'★'.repeat(report.priority)}</span>
                <span className="report-name">{label}</span>
                <span className="report-source">{report.dataSource}</span>
                <span className="report-insight">{report.insight}</span>
              </button>
            ))}
          </div>
        )}

        <div className="filters">
          <label className="filter">
            <span className="filter-label">GSC プロパティ</span>
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
              value={threshold ?? selectedUnit?.unit.threshold ?? selectedReport?.defaultThreshold ?? 0}
              onChange={(event) => setThreshold(Number(event.target.value))}
            />
          </label>
          <button className="button" type="button" onClick={handleRun} disabled={loading || !selectedUnit}>
            {loading ? '実行中…' : 'レポート実行'}
          </button>
        </div>

        {error ? <p className="alert">{error}</p> : null}
      </section>

      {result && result.rows.length > 0 && charts.length > 0 ? (
        <section className="card">
          <header className="card-header">
            <div>
              <h3 className="card-title">{selectedUnit?.label}（グラフ）</h3>
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
              <h3 className="card-title">{selectedUnit?.label}</h3>
              <p className="card-text">
                {result.rows.length} 行 ／ スキャン {(result.bytesProcessed / 1024 ** 2).toFixed(1)} MB
              </p>
            </div>
          </header>
          <ReportTable columns={result.columns} rows={result.rows} />
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
