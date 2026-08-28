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

export type McpEndpointResult = {
  id: string;
  name: string;
  auth: McpAuthMode;
  createdAt: string;
  token: string | null;
};

export function createMcpEndpoint(
  body: Settings & { name: string; auth: McpAuthMode },
): Promise<McpEndpointResult> {
  return request('/api/mcp/endpoints', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
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
