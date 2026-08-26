import { useState } from 'react';
import {
  loadSettings,
  saveSettings,
  validateSettings,
  type Settings as SettingsValue,
} from '../lib/settings';

const FIELDS: { key: keyof SettingsValue; label: string; placeholder: string; help: string }[] = [
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

export default function Settings() {
  const [values, setValues] = useState<SettingsValue>(() => loadSettings());
  const [errors, setErrors] = useState<Partial<Record<keyof SettingsValue, string>>>({});
  const [saved, setSaved] = useState(false);

  const handleChange = (key: keyof SettingsValue, value: string) => {
    setValues((current) => ({ ...current, [key]: value.trim() }));
    setSaved(false);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const nextErrors = validateSettings(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setSaved(false);
      return;
    }
    saveSettings(values);
    setSaved(true);
  };

  return (
    <section className="card">
      <header className="card-header">
        <div>
          <h2 className="card-title">Settings</h2>
          <p className="card-text">
            Analytics で参照する BigQuery のプロジェクトとデータセットを設定します。設定はこのブラウザに保存されます。
          </p>
        </div>
      </header>

      <form className="form" onSubmit={handleSubmit}>
        {FIELDS.map((field) => (
          <div className="form-row" key={field.key}>
            <label className="form-label" htmlFor={field.key}>
              {field.label}
            </label>
            <input
              id={field.key}
              className={errors[field.key] ? 'input has-error' : 'input'}
              value={values[field.key]}
              placeholder={field.placeholder}
              onChange={(event) => handleChange(field.key, event.target.value)}
              autoComplete="off"
            />
            <p className={errors[field.key] ? 'form-help is-error' : 'form-help'}>
              {errors[field.key] ?? field.help}
            </p>
          </div>
        ))}

        <div className="form-actions">
          <button className="button" type="submit">
            保存
          </button>
          {saved ? <span className="badge is-success">保存しました</span> : null}
        </div>
      </form>
    </section>
  );
}
