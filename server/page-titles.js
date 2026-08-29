import { buildPageTitlesQuery } from './reports.js';

const MAX_LOOKUP_KEYS = 500;

function normalizePath(path) {
  let value = path;
  try {
    value = decodeURIComponent(value);
  } catch {
    value = path;
  }
  value = value.replace(/\/+$/, '');
  return value === '' ? '/' : value.toLowerCase();
}

function normalizeHost(host) {
  return host.toLowerCase().replace(/^www\./, '');
}

export function pageReference(page) {
  if (typeof page !== 'string' || page === '') {
    return null;
  }
  const absolute = page.match(/^https?:\/\/([^/?#]+)([^?#]*)/);
  if (absolute) {
    return { host: normalizeHost(absolute[1]), key: normalizePath(absolute[2] || '/') };
  }
  if (page.startsWith('/')) {
    return { host: null, key: normalizePath(page) };
  }
  const [host, ...rest] = page.split('/');
  return { host: normalizeHost(host), key: normalizePath(`/${rest.join('/')}`) };
}

export async function attachPageTitles({ bigquery, report, rows, options, maximumBytesBilled }) {
  if (!bigquery || !rows?.length || !report.columns.some((column) => column.key === 'pageTitle')) {
    return rows;
  }

  const references = rows.map((row) => pageReference(row.page));
  const pageKeys = [...new Set(references.filter(Boolean).map((reference) => reference.key))];
  if (pageKeys.length === 0 || pageKeys.length > MAX_LOOKUP_KEYS) {
    return rows;
  }

  let titleRows;
  try {
    const { query, params, types } = buildPageTitlesQuery({
      project: options.project,
      ga4Dataset: options.ga4Dataset,
      startDate: options.startDate,
      endDate: options.endDate,
      pageKeys,
    });
    [titleRows] = await bigquery.query({ query, params, types, maximumBytesBilled });
  } catch (error) {
    console.warn('Page title lookup failed:', error?.message ?? error);
    return rows;
  }

  const byHostAndKey = new Map();
  const byKey = new Map();
  for (const { pageHost, pageKey, pageTitle } of titleRows) {
    byHostAndKey.set(`${pageHost}${pageKey}`, pageTitle);
    if (!byKey.has(pageKey)) {
      byKey.set(pageKey, pageTitle);
    }
  }

  return rows.map((row, index) => {
    const reference = references[index];
    if (!reference) {
      return row;
    }
    const title = reference.host ? byHostAndKey.get(`${reference.host}${reference.key}`) : null;
    return { ...row, pageTitle: title ?? byKey.get(reference.key) ?? null };
  });
}
