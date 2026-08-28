import type { Settings } from './settings';

export type ColumnType = 'text' | 'url' | 'number' | 'decimal' | 'percent';

export type ReportColumn = {
  key: string;
  label: string;
  type: ColumnType;
};

export type BarChartSpec = {
  type: 'bar';
  title: string;
  labelKey: string;
  valueKey: string;
};

export type ScatterChartSpec = {
  type: 'scatter';
  title: string;
  xKey: string;
  yKey: string;
  labelKey: string;
};

export type ChartSpec = BarChartSpec | ScatterChartSpec;

export type ReportDefinition = {
  id: string;
  name: string;
  dataSource: string;
  insight: string;
  priority: number;
  thresholdLabel: string;
  defaultThreshold: number;
  columns: ReportColumn[];
  charts: ChartSpec[];
};

export type ReportRow = Record<string, string | number | null>;

export type ReportResult = {
  reportId: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  bytesProcessed: number;
};

export type SiteOption = {
  siteUrl: string;
  lastDate: string;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `リクエストが失敗しました (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

export type McpAuthMode = 'token' | 'none';

export type McpInstance = {
  id: string;
  name: string;
  project: string;
  ga4Dataset: string;
  gscDataset: string;
  auth: McpAuthMode;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
};

export type McpInstanceResult = {
  instance: McpInstance;
  token: string | null;
};

export function fetchMcpInstances(): Promise<{ instances: McpInstance[]; store: string }> {
  return request('/api/mcp/instances');
}

export function createMcpInstance(
  body: Settings & { name: string; auth: McpAuthMode },
): Promise<McpInstanceResult> {
  return request('/api/mcp/instances', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function setMcpInstanceAuth(id: string, auth: McpAuthMode): Promise<McpInstanceResult> {
  return request(`/api/mcp/instances/${id}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ auth }),
  });
}

export function reissueMcpToken(id: string): Promise<McpInstanceResult> {
  return request(`/api/mcp/instances/${id}/token`, { method: 'POST' });
}

export function revokeMcpInstance(id: string): Promise<{ instance: McpInstance }> {
  return request(`/api/mcp/instances/${id}/revoke`, { method: 'POST' });
}

export function deleteMcpInstance(id: string): Promise<{ instance: McpInstance }> {
  return request(`/api/mcp/instances/${id}`, { method: 'DELETE' });
}

export function fetchReportCatalog(): Promise<{ reports: ReportDefinition[] }> {
  return request('/api/reports');
}

export function fetchSites(settings: Settings): Promise<{ sites: SiteOption[] }> {
  return request('/api/sites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: settings.project, gscDataset: settings.gscDataset }),
  });
}

export function runReport(
  reportId: string,
  body: Settings & { startDate: string; endDate: string; site: string | null; threshold: number; limit: number },
): Promise<ReportResult> {
  return request(`/api/reports/${reportId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
