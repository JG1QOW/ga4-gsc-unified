export type Settings = {
  project: string;
  ga4Dataset: string;
  gscDataset: string;
};

const STORAGE_KEY = 'ga4-gsc-unified:settings';

export const EMPTY_SETTINGS: Settings = { project: '', ga4Dataset: '', gscDataset: '' };

export function loadSettings(): Settings {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return EMPTY_SETTINGS;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      project: parsed.project ?? '',
      ga4Dataset: parsed.ga4Dataset ?? '',
      gscDataset: parsed.gscDataset ?? '',
    };
  } catch {
    return EMPTY_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function isComplete(settings: Settings): boolean {
  return Boolean(settings.project && settings.ga4Dataset && settings.gscDataset);
}

export function validateSettings(settings: Settings): Partial<Record<keyof Settings, string>> {
  const errors: Partial<Record<keyof Settings, string>> = {};
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(settings.project)) {
    errors.project = 'GCP プロジェクト ID の形式が不正です';
  }
  if (!/^[A-Za-z0-9_]+$/.test(settings.ga4Dataset)) {
    errors.ga4Dataset = '英数字とアンダースコアのみ使用できます';
  }
  if (!/^[A-Za-z0-9_]+$/.test(settings.gscDataset)) {
    errors.gscDataset = '英数字とアンダースコアのみ使用できます';
  }
  return errors;
}
