import { assertDatasetId, assertProjectId, ValidationError } from './bigquery.js';

const LOOKBACK_DAYS = 7;
const MAX_HOSTS = 5;
const MAX_DATASETS = 40;
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_BYTES_BILLED = process.env.DATASET_SCAN_MAX_BYTES_BILLED ?? String(20 * 1024 ** 3);

const cache = new Map();

const HOST_EXPR = `LOWER(REGEXP_REPLACE(REGEXP_EXTRACT(%s, r'^https?://([^/?#]+)'), r'^www\\.', ''))`;

function hostExpr(expr) {
  return HOST_EXPR.replace('%s', expr);
}

async function ga4Hosts(bigquery, project, dataset) {
  const [rows] = await bigquery.query({
    query: `SELECT host, COUNT(*) AS pageViews
FROM (
  SELECT ${hostExpr("(SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location')")} AS host
  FROM \`${project}.${dataset}.events_*\`
  WHERE _TABLE_SUFFIX >= FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL ${LOOKBACK_DAYS} DAY))
    AND event_name = 'page_view'
)
WHERE host IS NOT NULL
GROUP BY host
ORDER BY pageViews DESC
LIMIT ${MAX_HOSTS}`,
    maximumBytesBilled: MAX_BYTES_BILLED,
  });
  return rows.map((row) => ({ host: row.host, pageViews: Number(row.pageViews) }));
}

async function gscHosts(bigquery, project, dataset, site) {
  const [rows] = await bigquery.query({
    query: `SELECT host, SUM(clicks) AS clicks
FROM (
  SELECT
    IFNULL(
      ${hostExpr('url')},
      LOWER(REGEXP_REPLACE(REGEXP_EXTRACT(site_url, r'^(?:https?://|sc-domain:)?([^/?#]+)'), r'^www\\.', ''))
    ) AS host,
    clicks
  FROM \`${project}.${dataset}.searchdata_url_impression\`
  WHERE data_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
    AND (@site IS NULL OR site_url = @site)
)
WHERE host IS NOT NULL
GROUP BY host
ORDER BY clicks DESC
LIMIT ${MAX_HOSTS}`,
    params: { site: site ?? null },
    types: { site: 'STRING' },
    maximumBytesBilled: MAX_BYTES_BILLED,
  });
  return rows.map((row) => ({ host: row.host, clicks: Number(row.clicks) }));
}

export async function inspectGa4Datasets(bigquery, { project, gscDataset, site }) {
  assertProjectId(project);
  if (gscDataset !== undefined && gscDataset !== null && gscDataset !== '') {
    assertDatasetId(gscDataset, 'gscDataset');
  }
  if (site !== undefined && site !== null && typeof site !== 'string') {
    throw new ValidationError('site must be a string.');
  }

  const cacheKey = JSON.stringify([project, gscDataset ?? null, site ?? null]);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const [datasets] = await bigquery.getDatasets({ projectId: project });
  const ga4Datasets = datasets
    .map((dataset) => dataset.id)
    .filter((id) => id.startsWith('analytics_'))
    .sort()
    .slice(0, MAX_DATASETS);

  const searchHosts = gscDataset ? await gscHosts(bigquery, project, gscDataset, site) : [];
  const searchHostSet = new Set(searchHosts.map((entry) => entry.host));

  const candidates = [];
  for (const dataset of ga4Datasets) {
    try {
      const hosts = await ga4Hosts(bigquery, project, dataset);
      if (hosts.length === 0) {
        continue;
      }
      candidates.push({
        dataset,
        hosts,
        matches: hosts.some((entry) => searchHostSet.has(entry.host)),
      });
    } catch {
      continue;
    }
  }

  candidates.sort((a, b) => {
    if (a.matches !== b.matches) {
      return a.matches ? -1 : 1;
    }
    return (b.hosts[0]?.pageViews ?? 0) - (a.hosts[0]?.pageViews ?? 0);
  });

  const value = { gscHosts: searchHosts, candidates };
  cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}
