import { useState } from 'react';
import {
  emptySite,
  loadStore,
  saveStore,
  siteLabel,
  validateSite,
  type SiteConfig,
  type SettingsStore,
} from '../lib/settings';

const FIELDS: { key: keyof Omit<SiteConfig, 'id'>; label: string; placeholder: string; help: string }[] = [
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

  const updateSite = (id: string, key: keyof Omit<SiteConfig, 'id'>, value: string) => {
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
            Analytics で参照するサイトを複数登録できます。設定はこのブラウザに保存されます。
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
                </div>
              );
            })}
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
