export type Settings = {
  project: string;
  ga4Dataset: string;
  gscDataset: string;
};

export type ReportUnit = {
  id: string;
  reportId: string;
  label: string;
  threshold: number | null;
  limit: number;
};

export type McpEndpoint = {
  id: string;
  name: string;
  auth: 'token' | 'none';
  createdAt: string;
  token: string | null;
};

export type SiteConfig = Settings & {
  id: string;
  name: string;
  units: ReportUnit[];
  endpoints: McpEndpoint[];
};

export const DEFAULT_UNIT_LIMIT = 100;

export type SettingsStore = {
  sites: SiteConfig[];
  activeSiteId: string | null;
};

const STORAGE_KEY = 'ga4-gsc-unified:settings';

export const EMPTY_SETTINGS: Settings = { project: '', ga4Dataset: '', gscDataset: '' };

export function createSiteId(): string {
  return `site-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function emptySite(): SiteConfig {
  return { id: createSiteId(), name: '', units: [], endpoints: [], ...EMPTY_SETTINGS };
}

export function createUnit(reportId: string): ReportUnit {
  return { id: createSiteId(), reportId, label: '', threshold: null, limit: DEFAULT_UNIT_LIMIT };
}

function toReportUnit(value: Partial<ReportUnit>): ReportUnit | null {
  if (typeof value.reportId !== 'string' || !value.reportId) {
    return null;
  }
  return {
    id: typeof value.id === 'string' && value.id ? value.id : createSiteId(),
    reportId: value.reportId,
    label: value.label ?? '',
    threshold: typeof value.threshold === 'number' ? value.threshold : null,
    limit: typeof value.limit === 'number' && value.limit > 0 ? value.limit : DEFAULT_UNIT_LIMIT,
  };
}

function toMcpEndpoint(value: Partial<McpEndpoint>): McpEndpoint | null {
  if (typeof value.id !== 'string' || !value.id) {
    return null;
  }
  return {
    id: value.id,
    name: value.name ?? '',
    auth: value.auth === 'none' ? 'none' : 'token',
    createdAt: value.createdAt ?? '',
    token: typeof value.token === 'string' ? value.token : null,
  };
}

function toSiteConfig(value: Partial<SiteConfig>): SiteConfig {
  return {
    id: typeof value.id === 'string' && value.id ? value.id : createSiteId(),
    name: value.name ?? '',
    units: Array.isArray(value.units)
      ? value.units.map(toReportUnit).filter((unit): unit is ReportUnit => unit !== null)
      : [],
    endpoints: Array.isArray(value.endpoints)
      ? value.endpoints.map(toMcpEndpoint).filter((endpoint): endpoint is McpEndpoint => endpoint !== null)
      : [],
    project: value.project ?? '',
    ga4Dataset: value.ga4Dataset ?? '',
    gscDataset: value.gscDataset ?? '',
  };
}

function normalizeStore(parsed: Partial<SettingsStore> & Partial<SiteConfig>): SettingsStore {
  const sites = Array.isArray(parsed.sites) ? parsed.sites.map(toSiteConfig) : [];
  if (sites.length === 0 && (parsed.project || parsed.ga4Dataset || parsed.gscDataset)) {
    sites.push(toSiteConfig({ name: parsed.project ?? '', ...parsed }));
  }
  const activeSiteId =
    typeof parsed.activeSiteId === 'string' && sites.some((site) => site.id === parsed.activeSiteId)
      ? parsed.activeSiteId
      : (sites[0]?.id ?? null);
  return { sites, activeSiteId };
}

export function loadStore(): SettingsStore {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { sites: [], activeSiteId: null };
  }
  try {
    return normalizeStore(JSON.parse(raw) as Partial<SettingsStore> & Partial<SiteConfig>);
  } catch {
    return { sites: [], activeSiteId: null };
  }
}

export function saveStore(store: SettingsStore): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function saveActiveSiteId(activeSiteId: string | null): void {
  saveStore({ ...loadStore(), activeSiteId });
}

export function activeSite(store: SettingsStore): SiteConfig | null {
  return store.sites.find((site) => site.id === store.activeSiteId) ?? store.sites[0] ?? null;
}

export function siteLabel(site: SiteConfig): string {
  return site.name || site.gscDataset || site.project || '(名称未設定)';
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

export function validateSite(site: SiteConfig): Partial<Record<keyof Omit<SiteConfig, 'units' | 'endpoints'>, string>> {
  const errors: Partial<Record<keyof SiteConfig, string>> = validateSettings(site);
  if (!site.name.trim()) {
    errors.name = 'サイト名を入力してください';
  }
  return errors;
}
