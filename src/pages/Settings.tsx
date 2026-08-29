import { useEffect, useState } from 'react';
import { fetchReportCatalog, type ReportDefinition } from '../lib/api';
import McpServerPanel from '../components/McpServerPanel';
import Ga4DatasetFinder from '../components/Ga4DatasetFinder';
import {
  createUnit,
  DEFAULT_UNIT_LIMIT,
  emptySite,
  loadStore,
  saveStore,
  siteLabel,
  validateSite,
  type McpEndpoint,
  type ReportUnit,
  type SiteConfig,
  type SettingsStore,
} from '../lib/settings';
import { defaultUnits } from '../lib/units';

type SiteTextField = 'name' | 'project' | 'ga4Dataset' | 'gscDataset';

const FIELDS: { key: SiteTextField; label: string; placeholder: string; help: string }[] = [
  {
    key: 'name',
    label: 'サイト名',
    placeholder: 'example.com',
    help: 'Analytics のサイト切替に表示する名前',
  },
  {
    key: 'project',
    label: 'Project',
    placeholder: 'my-gcp-project',
    help: 'BigQuery のデータセットが存在する GCP プロジェクト ID',
  },
  {
    key: 'ga4Dataset',
    label: 'GA4 Dataset',
    placeholder: 'analytics_123456789',
    help: 'GA4 BigQuery Export のデータセット（events_* を含む）',
  },
  {
    key: 'gscDataset',
    label: 'GSC Dataset',
    placeholder: 'searchconsole',
    help: 'Search Console 一括データエクスポートのデータセット（searchdata_url_impression を含む）',
  },
];

type FieldErrors = Record<string, Partial<Record<keyof SiteConfig, string>>>;

export default function Settings() {
  const [store, setStore] = useState<SettingsStore>(() => {
    const loaded = loadStore();
    return loaded.sites.length > 0 ? loaded : { sites: [emptySite()], activeSiteId: null };
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saved, setSaved] = useState(false);
  const [catalog, setCatalog] = useState<ReportDefinition[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  useEffect(() => {
    fetchReportCatalog()
      .then(({ reports }) => setCatalog(reports))
      .catch((cause: Error) => setCatalogError(cause.message));
  }, []);

  const updateEndpoints = (siteId: string, endpoints: McpEndpoint[]) => {
    const next = {
      ...store,
      sites: store.sites.map((site) => (site.id === siteId ? { ...site, endpoints } : site)),
    };
    setStore(next);
    saveStore(next);
  };

  const updateUnits = (siteId: string, next: (units: ReportUnit[]) => ReportUnit[]) => {
    setStore((current) => ({
      ...current,
      sites: current.sites.map((site) => (site.id === siteId ? { ...site, units: next(site.units) } : site)),
    }));
    setSaved(false);
  };

  const updateUnit = <K extends keyof ReportUnit>(siteId: string, unitId: string, key: K, value: ReportUnit[K]) => {
    updateUnits(siteId, (units) => units.map((unit) => (unit.id === unitId ? { ...unit, [key]: value } : unit)));
  };

  const updateSite = (id: string, key: SiteTextField, value: string) => {
    setStore((current) => ({
      ...current,
      sites: current.sites.map((site) => (site.id === id ? { ...site, [key]: value.trim() } : site)),
    }));
    setSaved(false);
  };

  const addSite = () => {
    setStore((current) => ({ ...current, sites: [...current.sites, emptySite()] }));
    setSaved(false);
  };

  const removeSite = (id: string) => {
    setStore((current) => {
      const sites = current.sites.filter((site) => site.id !== id);
      return {
        sites: sites.length > 0 ? sites : [emptySite()],
        activeSiteId: current.activeSiteId === id ? null : current.activeSiteId,
      };
    });
    setSaved(false);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const nextErrors: FieldErrors = {};
    for (const site of store.sites) {
      const siteErrors = validateSite(site);
      if (Object.keys(siteErrors).length > 0) {
        nextErrors[site.id] = siteErrors;
      }
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setSaved(false);
      return;
    }
    const activeSiteId =
      store.activeSiteId && store.sites.some((site) => site.id === store.activeSiteId)
        ? store.activeSiteId
        : (store.sites[0]?.id ?? null);
    const next = { sites: store.sites, activeSiteId };
    saveStore(next);
    setStore(next);
    setSaved(true);
  };

  return (
    <section className="card">
      <header className="card-header">
        <div>
          <h2 className="card-title">Settings</h2>
          <p className="card-text">
            Analytics で参照するサイトと、サイトごとのレポートユニット構成を設定します。設定はこのブラウザに保存されます。
          </p>
        </div>
      </header>

      <form className="form" onSubmit={handleSubmit}>
        {store.sites.map((site, index) => (
          <fieldset className="site-config" key={site.id}>
            <legend className="site-config-legend">
              {index + 1}. {siteLabel(site)}
            </legend>
            {FIELDS.map((field) => {
              const inputId = `${site.id}-${field.key}`;
              const error = errors[site.id]?.[field.key];
              return (
                <div className="form-row" key={field.key}>
                  <label className="form-label" htmlFor={inputId}>
                    {field.label}
                  </label>
                  <input
                    id={inputId}
                    className={error ? 'input has-error' : 'input'}
                    value={site[field.key]}
                    placeholder={field.placeholder}
                    onChange={(event) => updateSite(site.id, field.key, event.target.value)}
                    autoComplete="off"
                  />
                  <p className={error ? 'form-help is-error' : 'form-help'}>{error ?? field.help}</p>
                  {field.key === 'ga4Dataset' ? (
                    <Ga4DatasetFinder
                      project={site.project}
                      ga4Dataset={site.ga4Dataset}
                      gscDataset={site.gscDataset}
                      onSelect={(dataset) => updateSite(site.id, 'ga4Dataset', dataset)}
                    />
                  ) : null}
                </div>
              );
            })}
            <div className="form-row">
              <span className="form-label">レポートユニット</span>
              <p className="form-help">
                Analytics に表示するレポートとその既定値をサイトごとに構成します。未構成の場合は全レポートを表示します。
              </p>
              {catalogError ? <p className="alert">{catalogError}</p> : null}
              <div className="unit-list">
                {site.units.map((unit) => {
                  const report = catalog.find((candidate) => candidate.id === unit.reportId);
                  return (
                    <div className="unit-row" key={unit.id}>
                      <select
                        className="input"
                        value={unit.reportId}
                        onChange={(event) => updateUnit(site.id, unit.id, 'reportId', event.target.value)}
                      >
                        {catalog.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name}
                          </option>
                        ))}
                        {report ? null : <option value={unit.reportId}>{unit.reportId}（未知のレポート）</option>}
                      </select>
                      <input
                        className="input"
                        value={unit.label}
                        placeholder={report?.name ?? '表示名'}
                        onChange={(event) => updateUnit(site.id, unit.id, 'label', event.target.value)}
                        autoComplete="off"
                      />
                      <input
                        className="input"
                        type="number"
                        min={0}
                        value={unit.threshold ?? report?.defaultThreshold ?? 0}
                        onChange={(event) => updateUnit(site.id, unit.id, 'threshold', Number(event.target.value))}
                        title={report?.thresholdLabel ?? 'しきい値'}
                      />
                      <input
                        className="input"
                        type="number"
                        min={1}
                        value={unit.limit}
                        onChange={(event) =>
                          updateUnit(site.id, unit.id, 'limit', Number(event.target.value) || DEFAULT_UNIT_LIMIT)
                        }
                        title="最大行数"
                      />
                      <button
                        className="button is-ghost"
                        type="button"
                        onClick={() => updateUnits(site.id, (units) => units.filter((item) => item.id !== unit.id))}
                      >
                        削除
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="form-actions">
                <button
                  className="button is-ghost"
                  type="button"
                  disabled={catalog.length === 0}
                  onClick={() =>
                    updateUnits(site.id, (units) => [...units, createUnit(catalog[0]?.id ?? '')])
                  }
                >
                  ユニットを追加
                </button>
                {site.units.length === 0 ? (
                  <button
                    className="button is-ghost"
                    type="button"
                    disabled={catalog.length === 0}
                    onClick={() => updateUnits(site.id, () => defaultUnits(catalog))}
                  >
                    全レポートを追加
                  </button>
                ) : null}
              </div>
            </div>

            <McpServerPanel site={site} onChange={(endpoints) => updateEndpoints(site.id, endpoints)} />

            <div className="form-actions">
              <button className="button is-ghost" type="button" onClick={() => removeSite(site.id)}>
                このサイトを削除
              </button>
            </div>
          </fieldset>
        ))}

        <div className="form-actions">
          <button className="button" type="submit">
            保存
          </button>
          <button className="button is-ghost" type="button" onClick={addSite}>
            サイトを追加
          </button>
          {saved ? <span className="badge is-success">保存しました</span> : null}
        </div>
      </form>
    </section>
  );
}
