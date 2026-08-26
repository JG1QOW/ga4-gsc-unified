import type { Settings } from './settings';

export type ColumnType = 'text' | 'url' | 'number' | 'decimal' | 'percent';

export type ReportColumn = {
  key: string;
  label: string;
  type: ColumnType;
};

export type ReportDefinition = {
  id: string;
  name: string;
  dataSource: string;
  insight: string;
  priority: number;
  thresholdLabel: string;
  defaultThreshold: number;
  columns: ReportColumn[];
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
