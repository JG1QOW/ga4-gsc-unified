import { assertDatasetId, assertDate, assertProjectId, ValidationError } from './bigquery.js';

const PAGE_PATH_EXPR = "REGEXP_EXTRACT(%s, r'^https?://[^/]+([^?#]*)')";
const PAGE_HOST_EXPR = "REGEXP_EXTRACT(%s, r'^https?://([^/]+)')";

function pagePath(expr) {
  return PAGE_PATH_EXPR.replace('%s', expr);
}

function pageHost(expr) {
  return PAGE_HOST_EXPR.replace('%s', expr);
}

function urlImpressionTable({ project, gscDataset }) {
  return `\`${project}.${gscDataset}.searchdata_url_impression\``;
}

function ga4EventsTable({ project, ga4Dataset }) {
  return `\`${project}.${ga4Dataset}.events_*\``;
}

function toSuffix(date) {
  return date.replace(/-/g, '');
}

function hostFromSite(site) {
  if (!site) {
    return null;
  }
  if (site.startsWith('sc-domain:')) {
    return site.slice('sc-domain:'.length);
  }
  const host = site.match(/^https?:\/\/([^/]+)/);
  return host ? host[1] : null;
}

const GA4_EVENT_FIELDS = `
    CONCAT(
      user_pseudo_id,
      '-',
      CAST(IFNULL((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id'), 0) AS STRING)
    ) AS session_key,
    ${pagePath("(SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location')")} AS page_path,
    ${pageHost("(SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location')")} AS page_host`;

export const REPORTS = [
  {
    id: 'discover-lifecycle',
    name: 'Discoverページライフサイクル',
    dataSource: 'SC',
    insight: 'Discoverに載ってから何日伸びるか',
    priority: 3,
    thresholdLabel: '最小クリック数',
    defaultThreshold: 10,
    columns: [
      { key: 'page', label: 'ページ', type: 'url' },
      { key: 'firstDate', label: '初回掲載日', type: 'text' },
      { key: 'lastDate', label: '最終掲載日', type: 'text' },
      { key: 'spanDays', label: '掲載期間(日)', type: 'number' },
      { key: 'activeDays', label: '露出日数', type: 'number' },
      { key: 'impressions', label: '表示', type: 'number' },
      { key: 'clicks', label: 'クリック', type: 'number' },
      { key: 'peakDayOffset', label: 'ピーク(掲載後n日)', type: 'number' },
      { key: 'first3DaysClickRate', label: '最初3日のクリック比率', type: 'percent' },
    ],
    build: ({ project, gscDataset, startDate, endDate, site, threshold, limit }) => ({
      query: `
WITH daily AS (
  SELECT url, data_date, SUM(clicks) AS clicks, SUM(impressions) AS impressions
  FROM ${urlImpressionTable({ project, gscDataset })}
  WHERE data_date BETWEEN PARSE_DATE('%Y-%m-%d', @startDate) AND PARSE_DATE('%Y-%m-%d', @endDate)
    AND search_type = 'DISCOVER'
    AND (@site IS NULL OR site_url = @site)
  GROUP BY url, data_date
),
enriched AS (
  SELECT
    url,
    data_date,
    clicks,
    impressions,
    MIN(data_date) OVER (PARTITION BY url) AS first_date,
    MAX(data_date) OVER (PARTITION BY url) AS last_date
  FROM daily
)
SELECT
  url AS page,
  FORMAT_DATE('%Y-%m-%d', ANY_VALUE(first_date)) AS firstDate,
  FORMAT_DATE('%Y-%m-%d', ANY_VALUE(last_date)) AS lastDate,
  DATE_DIFF(ANY_VALUE(last_date), ANY_VALUE(first_date), DAY) + 1 AS spanDays,
  COUNT(*) AS activeDays,
  SUM(impressions) AS impressions,
  SUM(clicks) AS clicks,
  ARRAY_AGG(DATE_DIFF(data_date, first_date, DAY) ORDER BY enriched.clicks DESC, data_date LIMIT 1)[SAFE_OFFSET(0)] AS peakDayOffset,
  SAFE_DIVIDE(SUM(IF(DATE_DIFF(data_date, first_date, DAY) <= 2, clicks, 0)), SUM(clicks)) AS first3DaysClickRate
FROM enriched
GROUP BY url
HAVING clicks >= @threshold
ORDER BY clicks DESC
LIMIT @rowLimit`,
      params: { startDate, endDate, site, threshold, rowLimit: limit },
      types: { startDate: 'STRING', endDate: 'STRING', site: 'STRING', threshold: 'INT64', rowLimit: 'INT64' },
    }),
  },
  {
    id: 'seo-opportunities',
    name: 'SEO改善候補ランキング',
    dataSource: 'SC',
    insight: '表示は多いのにCTR・順位が悪いページ',
    priority: 3,
    thresholdLabel: '最小表示回数',
    defaultThreshold: 1000,
    columns: [
      { key: 'page', label: 'ページ', type: 'url' },
      { key: 'impressions', label: '表示', type: 'number' },
      { key: 'clicks', label: 'クリック', type: 'number' },
      { key: 'ctr', label: 'CTR', type: 'percent' },
      { key: 'avgPosition', label: '平均順位', type: 'decimal' },
      { key: 'opportunityClicks', label: '改善余地(クリック)', type: 'decimal' },
    ],
    build: ({ project, gscDataset, startDate, endDate, site, threshold, limit }) => ({
      query: `
WITH agg AS (
  SELECT
    url,
    SUM(impressions) AS impressions,
    SUM(clicks) AS clicks,
    SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
    SAFE_DIVIDE(SUM(sum_position), SUM(impressions)) + 1 AS avg_position
  FROM ${urlImpressionTable({ project, gscDataset })}
  WHERE data_date BETWEEN PARSE_DATE('%Y-%m-%d', @startDate) AND PARSE_DATE('%Y-%m-%d', @endDate)
    AND search_type = 'WEB'
    AND (@site IS NULL OR site_url = @site)
  GROUP BY url
  HAVING impressions >= @threshold
)
SELECT
  url AS page,
  impressions,
  clicks,
  ctr,
  avg_position AS avgPosition,
  GREATEST(impressions * (@targetCtr - IFNULL(ctr, 0)), 0) AS opportunityClicks
FROM agg
WHERE IFNULL(ctr, 0) < @targetCtr OR avg_position > 5
ORDER BY opportunityClicks DESC, impressions DESC
LIMIT @rowLimit`,
      params: { startDate, endDate, site, threshold, targetCtr: 0.05, rowLimit: limit },
      types: {
        startDate: 'STRING',
        endDate: 'STRING',
        site: 'STRING',
        threshold: 'INT64',
        targetCtr: 'FLOAT64',
        rowLimit: 'INT64',
      },
    }),
  },
  {
    id: 'post-arrival-quality',
    name: 'ページ別「流入後品質」',
    dataSource: 'GA4×SC',
    insight: '検索/Discoverで来た読者が実際に読んだか',
    priority: 3,
    thresholdLabel: '最小クリック数',
    defaultThreshold: 20,
    columns: [
      { key: 'page', label: 'ページ', type: 'text' },
      { key: 'searchClicks', label: '検索クリック', type: 'number' },
      { key: 'discoverClicks', label: 'Discoverクリック', type: 'number' },
      { key: 'sessions', label: 'セッション', type: 'number' },
      { key: 'engagementRate', label: 'エンゲージメント率', type: 'percent' },
      { key: 'avgEngagementSeconds', label: '平均滞在(秒)', type: 'decimal' },
      { key: 'scrollRate', label: 'スクロール到達率', type: 'percent' },
    ],
    build: ({ project, ga4Dataset, gscDataset, startDate, endDate, site, threshold, limit }) => ({
      query: `
WITH events AS (
  SELECT
    event_name,${GA4_EVENT_FIELDS},
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'session_engaged') AS session_engaged,
    IFNULL((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'engagement_time_msec'), 0) AS engagement_msec
  FROM ${ga4EventsTable({ project, ga4Dataset })}
  WHERE _TABLE_SUFFIX BETWEEN @startSuffix AND @endSuffix
),
ga AS (
  SELECT
    page_path,
    COUNT(DISTINCT session_key) AS sessions,
    COUNT(DISTINCT IF(session_engaged = '1', session_key, NULL)) AS engaged_sessions,
    COUNT(DISTINCT IF(event_name = 'scroll', session_key, NULL)) AS scroll_sessions,
    SAFE_DIVIDE(SUM(engagement_msec) / 1000, COUNT(DISTINCT session_key)) AS avg_engagement_seconds
  FROM events
  WHERE page_path IS NOT NULL
    AND (@host IS NULL OR page_host = @host)
  GROUP BY page_path
),
sc AS (
  SELECT
    ${pagePath('url')} AS page_path,
    SUM(clicks) AS clicks,
    SUM(IF(search_type = 'WEB', clicks, 0)) AS search_clicks,
    SUM(IF(search_type = 'DISCOVER', clicks, 0)) AS discover_clicks
  FROM ${urlImpressionTable({ project, gscDataset })}
  WHERE data_date BETWEEN PARSE_DATE('%Y-%m-%d', @startDate) AND PARSE_DATE('%Y-%m-%d', @endDate)
    AND (@site IS NULL OR site_url = @site)
  GROUP BY page_path
)
SELECT
  page_path AS page,
  sc.search_clicks AS searchClicks,
  sc.discover_clicks AS discoverClicks,
  ga.sessions,
  SAFE_DIVIDE(ga.engaged_sessions, ga.sessions) AS engagementRate,
  ga.avg_engagement_seconds AS avgEngagementSeconds,
  SAFE_DIVIDE(ga.scroll_sessions, ga.sessions) AS scrollRate
FROM sc
JOIN ga USING (page_path)
WHERE sc.clicks >= @threshold
ORDER BY sc.clicks DESC
LIMIT @rowLimit`,
      params: {
        startDate,
        endDate,
        startSuffix: toSuffix(startDate),
        endSuffix: toSuffix(endDate),
        site,
        host: hostFromSite(site),
        threshold,
        rowLimit: limit,
      },
      types: {
        startDate: 'STRING',
        endDate: 'STRING',
        startSuffix: 'STRING',
        endSuffix: 'STRING',
        site: 'STRING',
        host: 'STRING',
        threshold: 'INT64',
        rowLimit: 'INT64',
      },
    }),
  },
  {
    id: 'onward-navigation',
    name: 'ページ回遊力ランキング',
    dataSource: 'GA4',
    insight: '次のページへ送客できるページ',
    priority: 3,
    thresholdLabel: '最小ページビュー',
    defaultThreshold: 100,
    columns: [
      { key: 'page', label: 'ページ', type: 'text' },
      { key: 'pageViews', label: 'ページビュー', type: 'number' },
      { key: 'sessions', label: 'セッション', type: 'number' },
      { key: 'onwardViews', label: '次ページ遷移', type: 'number' },
      { key: 'onwardRate', label: '回遊率', type: 'percent' },
      { key: 'exitRate', label: '離脱率', type: 'percent' },
    ],
    build: ({ project, ga4Dataset, startDate, endDate, site, threshold, limit }) => ({
      query: `
WITH page_views AS (
  SELECT
    event_timestamp,${GA4_EVENT_FIELDS}
  FROM ${ga4EventsTable({ project, ga4Dataset })}
  WHERE _TABLE_SUFFIX BETWEEN @startSuffix AND @endSuffix
    AND event_name = 'page_view'
),
sequenced AS (
  SELECT
    session_key,
    page_path,
    page_host,
    LEAD(page_path) OVER (PARTITION BY session_key ORDER BY event_timestamp) AS next_path
  FROM page_views
  WHERE page_path IS NOT NULL
)
SELECT
  page_path AS page,
  COUNT(*) AS pageViews,
  COUNT(DISTINCT session_key) AS sessions,
  COUNTIF(next_path IS NOT NULL AND next_path != page_path) AS onwardViews,
  SAFE_DIVIDE(COUNTIF(next_path IS NOT NULL AND next_path != page_path), COUNT(*)) AS onwardRate,
  SAFE_DIVIDE(COUNTIF(next_path IS NULL), COUNT(*)) AS exitRate
FROM sequenced
WHERE @host IS NULL OR page_host = @host
GROUP BY page_path
HAVING pageViews >= @threshold
ORDER BY onwardRate DESC, pageViews DESC
LIMIT @rowLimit`,
      params: {
        startSuffix: toSuffix(startDate),
        endSuffix: toSuffix(endDate),
        host: hostFromSite(site),
        threshold,
        rowLimit: limit,
      },
      types: {
        startSuffix: 'STRING',
        endSuffix: 'STRING',
        host: 'STRING',
        threshold: 'INT64',
        rowLimit: 'INT64',
      },
    }),
  },
];

export function reportCatalog() {
  return REPORTS.map(({ id, name, dataSource, insight, priority, thresholdLabel, defaultThreshold, columns }) => ({
    id,
    name,
    dataSource,
    insight,
    priority,
    thresholdLabel,
    defaultThreshold,
    columns,
  }));
}

export function buildReportQuery(reportId, options) {
  const report = REPORTS.find((candidate) => candidate.id === reportId);
  if (!report) {
    throw new ValidationError(`Unknown report: ${String(reportId)}`);
  }
  const project = assertProjectId(options.project);
  const startDate = assertDate(options.startDate, 'startDate');
  const endDate = assertDate(options.endDate, 'endDate');
  const ga4Dataset = report.dataSource.includes('GA4')
    ? assertDatasetId(options.ga4Dataset, 'ga4Dataset')
    : null;
  const gscDataset = report.dataSource.includes('SC')
    ? assertDatasetId(options.gscDataset, 'gscDataset')
    : null;
  const threshold = Number.isFinite(options.threshold) ? Math.trunc(options.threshold) : report.defaultThreshold;
  const limit = Number.isFinite(options.limit) ? Math.min(Math.trunc(options.limit), 500) : 100;
  const site = typeof options.site === 'string' && options.site.length > 0 ? options.site : null;

  return {
    report,
    ...report.build({ project, ga4Dataset, gscDataset, startDate, endDate, site, threshold, limit }),
  };
}

export function buildSitesQuery({ project, gscDataset }) {
  assertProjectId(project);
  assertDatasetId(gscDataset, 'gscDataset');
  return {
    query: `
SELECT site_url AS siteUrl, FORMAT_DATE('%Y-%m-%d', MAX(data_date)) AS lastDate
FROM ${urlImpressionTable({ project, gscDataset })}
GROUP BY site_url
ORDER BY site_url`,
  };
}
