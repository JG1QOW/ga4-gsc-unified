import { assertDatasetId, assertDate, assertProjectId, ValidationError } from './bigquery.js';

const PAGE_PATH_EXPR = "IFNULL(NULLIF(REGEXP_EXTRACT(%s, r'^https?://[^/?#]*([^?#]*)'), ''), '/')";
const PAGE_HOST_EXPR = "REGEXP_EXTRACT(%s, r'^https?://([^/?#]+)')";

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

const GA4_EVENT_DAY_EXPR = "REGEXP_EXTRACT(_TABLE_SUFFIX, r'(\\d{8})$')";

function ga4DailyTableDays({ project, ga4Dataset }) {
  return `SELECT REGEXP_EXTRACT(table_name, r'(\\d{8})$')
      FROM \`${project}.${ga4Dataset}.INFORMATION_SCHEMA.TABLES\`
      WHERE REGEXP_CONTAINS(table_name, r'^events_\\d{8}$')`;
}

function ga4EventDayFilter({ project, ga4Dataset }) {
  return `${GA4_EVENT_DAY_EXPR} BETWEEN @startSuffix AND @endSuffix
    AND (NOT STARTS_WITH(_TABLE_SUFFIX, 'intraday_')
      OR ${GA4_EVENT_DAY_EXPR} NOT IN (${ga4DailyTableDays({ project, ga4Dataset })}))`;
}

function toSuffix(date) {
  return date.replace(/-/g, '');
}

function hostFromSite(site) {
  if (!site) {
    return null;
  }
  const raw = site.startsWith('sc-domain:')
    ? site.slice('sc-domain:'.length)
    : (site.match(/^https?:\/\/([^/]+)/) ?? [])[1];
  if (!raw) {
    return null;
  }
  return raw.toLowerCase().replace(/^www\./, '').replace(/\/.*$/, '');
}

function normalizedHost(expr) {
  return `LOWER(REGEXP_REPLACE(${expr}, r'^www\\.', ''))`;
}

const NORM_PATH_UDF = `CREATE TEMP FUNCTION normPath(path STRING) RETURNS STRING LANGUAGE js AS r"""
  if (!path) { return null; }
  var p = path;
  try { p = decodeURIComponent(p); } catch (e) {}
  while (p.length > 1 && p.charAt(p.length - 1) === '/') { p = p.substring(0, p.length - 1); }
  return p === '' ? '/' : p.toLowerCase();
""";`;

function midDate(startDate, endDate) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  const days = Math.round((end - start) / 86_400_000) + 1;
  return new Date(start + Math.floor(days / 2) * 86_400_000).toISOString().slice(0, 10);
}

function brandFromSite(site) {
  const host = hostFromSite(site);
  return host ? host.split('.')[0] : null;
}

const SITE_HOST_EXPR = normalizedHost("REGEXP_EXTRACT(site_url, r'^(?:https?://|sc-domain:)?([^/?#]+)')");

const GSC_PAGE_HOST_EXPR = `IFNULL(${normalizedHost(pageHost('url'))}, ${SITE_HOST_EXPR})`;

const ORGANIC_SESSION_FILTER = `LOWER(IFNULL(session_traffic_source_last_click.manual_campaign.medium, '')) = 'organic'`;

const QUERY_FILTER = `AND query IS NOT NULL AND NOT IFNULL(is_anonymized_query, FALSE)`;

const PAGE_LOCATION_EXPR = "(SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location')";

const GA4_EVENT_FIELDS = `
    CONCAT(
      user_pseudo_id,
      '-',
      CAST(IFNULL((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id'), 0) AS STRING)
    ) AS session_key,
    ${pagePath(PAGE_LOCATION_EXPR)} AS page_path,
    ${normalizedHost(pageHost(PAGE_LOCATION_EXPR))} AS page_host`;

function buildPeriodComparison({
  project,
  ga4Dataset,
  gscDataset,
  startDate,
  endDate,
  site,
  threshold,
  limit,
  direction,
}) {
  const splitDate = midDate(startDate, endDate);
  const trendFilter =
    direction === 'up' ? 'sc.recent_clicks > sc.previous_clicks' : 'sc.recent_clicks < sc.previous_clicks';
  const deltaColumn =
    direction === 'up'
      ? 'sc.recent_clicks - sc.previous_clicks AS clicksGained'
      : 'sc.previous_clicks - sc.recent_clicks AS clicksDropped';
  const orderColumn = direction === 'up' ? 'clicksGained' : 'clicksDropped';
  const positionColumn =
    direction === 'up'
      ? `,
  SAFE_DIVIDE(sc.previous_position_sum, NULLIF(sc.previous_impressions, 0)) -
    SAFE_DIVIDE(sc.recent_position_sum, NULLIF(sc.recent_impressions, 0)) AS positionImprovement`
      : '';

  return {
    query: `${NORM_PATH_UDF}
WITH sc_raw AS (
  SELECT
    ${pagePath('url')} AS page_path,
    ${GSC_PAGE_HOST_EXPR} AS page_host,
    SUM(IF(data_date >= PARSE_DATE('%Y-%m-%d', @splitDate), clicks, 0)) AS recent_clicks,
    SUM(IF(data_date < PARSE_DATE('%Y-%m-%d', @splitDate), clicks, 0)) AS previous_clicks,
    SUM(IF(data_date >= PARSE_DATE('%Y-%m-%d', @splitDate), impressions, 0)) AS recent_impressions,
    SUM(IF(data_date < PARSE_DATE('%Y-%m-%d', @splitDate), impressions, 0)) AS previous_impressions,
    SUM(IF(data_date >= PARSE_DATE('%Y-%m-%d', @splitDate), sum_position, 0)) AS recent_position_sum,
    SUM(IF(data_date < PARSE_DATE('%Y-%m-%d', @splitDate), sum_position, 0)) AS previous_position_sum
  FROM ${urlImpressionTable({ project, gscDataset })}
  WHERE data_date BETWEEN PARSE_DATE('%Y-%m-%d', @startDate) AND PARSE_DATE('%Y-%m-%d', @endDate)
    AND search_type = 'WEB'
    AND (@site IS NULL OR site_url = @site)
  GROUP BY page_path, page_host
),
sc AS (
  SELECT
    normPath(page_path) AS page_key,
    page_host,
    SUM(recent_clicks) AS recent_clicks,
    SUM(previous_clicks) AS previous_clicks,
    SUM(recent_impressions) AS recent_impressions,
    SUM(previous_impressions) AS previous_impressions,
    SUM(recent_position_sum) AS recent_position_sum,
    SUM(previous_position_sum) AS previous_position_sum
  FROM sc_raw
  GROUP BY page_key, page_host
),
events AS (
  SELECT${GA4_EVENT_FIELDS},
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'session_engaged') AS session_engaged
  FROM ${ga4EventsTable({ project, ga4Dataset })}
  WHERE ${ga4EventDayFilter({ project, ga4Dataset })}
),
ga_raw AS (
  SELECT
    page_path,
    page_host,
    COUNT(DISTINCT session_key) AS sessions,
    COUNT(DISTINCT IF(session_engaged = '1', session_key, NULL)) AS engaged_sessions
  FROM events
  WHERE page_path IS NOT NULL
  GROUP BY page_path, page_host
),
ga AS (
  SELECT
    normPath(page_path) AS page_key,
    page_host,
    SUM(sessions) AS sessions,
    SUM(engaged_sessions) AS engaged_sessions
  FROM ga_raw
  GROUP BY page_key, page_host
)
SELECT
  CONCAT(sc.page_host, sc.page_key) AS page,
  sc.previous_clicks AS previousClicks,
  sc.recent_clicks AS recentClicks,
  ${deltaColumn},
  SAFE_DIVIDE(sc.recent_clicks - sc.previous_clicks, NULLIF(sc.previous_clicks, 0)) AS changeRate,
  SAFE_DIVIDE(sc.previous_position_sum, NULLIF(sc.previous_impressions, 0)) + 1 AS previousAvgPosition,
  SAFE_DIVIDE(sc.recent_position_sum, NULLIF(sc.recent_impressions, 0)) + 1 AS recentAvgPosition${positionColumn},
  ga.sessions,
  SAFE_DIVIDE(ga.engaged_sessions, ga.sessions) AS engagementRate
FROM sc
LEFT JOIN ga USING (page_host, page_key)
WHERE sc.previous_clicks >= @threshold
  AND ${trendFilter}
ORDER BY ${orderColumn} DESC
LIMIT @rowLimit`,
    params: {
      startDate,
      endDate,
      splitDate,
      startSuffix: toSuffix(startDate),
      endSuffix: toSuffix(endDate),
      site,
      threshold,
      rowLimit: limit,
    },
    types: {
      startDate: 'STRING',
      endDate: 'STRING',
      splitDate: 'STRING',
      startSuffix: 'STRING',
      endSuffix: 'STRING',
      site: 'STRING',
      threshold: 'INT64',
      rowLimit: 'INT64',
    },
  };
}

const REPORT_DEFINITIONS = [
  {
    id: 'discover-lifecycle',
    name: 'Discoverページライフサイクル',
    dataSource: 'SC',
    insight: 'Discoverに載ってから何日伸びるか',
    priority: 3,
    thresholdLabel: '最小クリック数',
    defaultThreshold: 10,
    methodology: [
      '対象データ: GSC `searchdata_url_impression` の search_type = DISCOVER 行を、期間・GSC プロパティで絞り込み、URL×日付ごとにクリック・表示を合計します。',
      '初回掲載日 / 最終掲載日: 期間内でその URL が Discover に表示された最初と最後の日付。掲載期間(日) = 最終掲載日 − 初回掲載日 + 1。',
      '露出日数: 期間内で 1 回以上表示された日数。',
      'ピーク(掲載後n日): 1 日のクリックが最大だった日の、初回掲載日からの経過日数（0 = 初日）。',
      '最初3日のクリック比率: 掲載後 0〜2 日目のクリック合計 ÷ 期間内クリック合計。',
      '抽出条件・並び順: 期間内クリック合計がしきい値以上の URL を、クリックの多い順に表示します。',
    ],
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
    charts: [
      { type: 'bar', title: 'クリック上位ページ', labelKey: 'page', valueKey: 'clicks' },
      { type: 'scatter', title: '掲載期間とクリックの関係', xKey: 'spanDays', yKey: 'clicks', labelKey: 'page' },
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
    methodology: [
      '対象データ: GSC `searchdata_url_impression` の search_type = WEB 行を、期間・GSC プロパティで絞り込み、URL ごとに表示・クリックを合計します。',
      'CTR = クリック ÷ 表示。平均順位 = sum_position ÷ 表示 + 1（GSC のエクスポートは 0 始まりのため +1）。',
      '改善余地(クリック) = 表示 × (目標 CTR 5% − 実際の CTR)。マイナスになる場合は 0。',
      '抽出条件: 表示がしきい値以上で、かつ「CTR が 5% 未満」または「平均順位が 5 より下位」のページ。',
      '並び順: 改善余地(クリック) の大きい順、同値なら表示の多い順。',
    ],
    columns: [
      { key: 'page', label: 'ページ', type: 'url' },
      { key: 'impressions', label: '表示', type: 'number' },
      { key: 'clicks', label: 'クリック', type: 'number' },
      { key: 'ctr', label: 'CTR', type: 'percent' },
      { key: 'avgPosition', label: '平均順位', type: 'decimal' },
      { key: 'opportunityClicks', label: '改善余地(クリック)', type: 'decimal' },
    ],
    charts: [
      { type: 'bar', title: '改善余地の大きいページ', labelKey: 'page', valueKey: 'opportunityClicks' },
      { type: 'scatter', title: '平均順位とCTRの関係', xKey: 'avgPosition', yKey: 'ctr', labelKey: 'page' },
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
    methodology: [
      'GSC 側: `searchdata_url_impression` を期間・GSC プロパティで絞り込み、ページごとにクリック合計（全検索タイプ）、検索クリック（search_type = WEB）、Discover クリック（search_type = DISCOVER）を集計します。',
      'GA4 側: `events_*` を期間で絞り込み、page_location からホストとパスを取り出してページごとに集計します。セッション = user_pseudo_id + ga_session_id の組み合わせの数。',
      'エンゲージメント率 = session_engaged = 1 のイベントを含むセッション数 ÷ セッション数。平均滞在(秒) = engagement_time_msec の合計 ÷ セッション数。スクロール到達率 = scroll イベントが発生したセッション数 ÷ セッション数。',
      '結合: ホスト（www. 有無・大文字小文字）とパス（末尾スラッシュ・URL エンコード・大文字小文字）を正規化して、GSC 側を基準に GA4 側を LEFT JOIN します。GA4 に該当ページが無い場合は GA4 指標が空になります。',
      '抽出条件・並び順: GSC のクリック合計がしきい値以上のページを、クリックの多い順に表示します。',
    ],
    columns: [
      { key: 'page', label: 'ページ', type: 'text' },
      { key: 'searchClicks', label: '検索クリック', type: 'number' },
      { key: 'discoverClicks', label: 'Discoverクリック', type: 'number' },
      { key: 'sessions', label: 'セッション', type: 'number' },
      { key: 'engagementRate', label: 'エンゲージメント率', type: 'percent' },
      { key: 'avgEngagementSeconds', label: '平均滞在(秒)', type: 'decimal' },
      { key: 'scrollRate', label: 'スクロール到達率', type: 'percent' },
    ],
    charts: [
      { type: 'bar', title: 'エンゲージメント率上位ページ', labelKey: 'page', valueKey: 'engagementRate' },
      {
        type: 'scatter',
        title: '検索クリックとエンゲージメント率の関係',
        xKey: 'searchClicks',
        yKey: 'engagementRate',
        labelKey: 'page',
      },
    ],
    build: ({ project, ga4Dataset, gscDataset, startDate, endDate, site, threshold, limit }) => ({
      query: `${NORM_PATH_UDF}
WITH events AS (
  SELECT
    event_name,${GA4_EVENT_FIELDS},
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'session_engaged') AS session_engaged,
    IFNULL((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'engagement_time_msec'), 0) AS engagement_msec
  FROM ${ga4EventsTable({ project, ga4Dataset })}
  WHERE ${ga4EventDayFilter({ project, ga4Dataset })}
),
ga_raw AS (
  SELECT
    page_path,
    page_host,
    COUNT(DISTINCT session_key) AS sessions,
    COUNT(DISTINCT IF(session_engaged = '1', session_key, NULL)) AS engaged_sessions,
    COUNT(DISTINCT IF(event_name = 'scroll', session_key, NULL)) AS scroll_sessions,
    SUM(engagement_msec) / 1000 AS engagement_seconds
  FROM events
  WHERE page_path IS NOT NULL
    AND (@host IS NULL OR page_host = @host)
  GROUP BY page_path, page_host
),
ga AS (
  SELECT
    normPath(page_path) AS page_key,
    page_host,
    SUM(sessions) AS sessions,
    SUM(engaged_sessions) AS engaged_sessions,
    SUM(scroll_sessions) AS scroll_sessions,
    SUM(engagement_seconds) AS engagement_seconds
  FROM ga_raw
  GROUP BY page_key, page_host
),
sc_raw AS (
  SELECT
    ${pagePath('url')} AS page_path,
    ${GSC_PAGE_HOST_EXPR} AS page_host,
    SUM(clicks) AS clicks,
    SUM(IF(search_type = 'WEB', clicks, 0)) AS search_clicks,
    SUM(IF(search_type = 'DISCOVER', clicks, 0)) AS discover_clicks
  FROM ${urlImpressionTable({ project, gscDataset })}
  WHERE data_date BETWEEN PARSE_DATE('%Y-%m-%d', @startDate) AND PARSE_DATE('%Y-%m-%d', @endDate)
    AND (@site IS NULL OR site_url = @site)
  GROUP BY page_path, page_host
),
sc AS (
  SELECT
    normPath(page_path) AS page_key,
    page_host,
    SUM(clicks) AS clicks,
    SUM(search_clicks) AS search_clicks,
    SUM(discover_clicks) AS discover_clicks
  FROM sc_raw
  GROUP BY page_key, page_host
)
SELECT
  CONCAT(sc.page_host, sc.page_key) AS page,
  sc.search_clicks AS searchClicks,
  sc.discover_clicks AS discoverClicks,
  ga.sessions,
  SAFE_DIVIDE(ga.engaged_sessions, ga.sessions) AS engagementRate,
  SAFE_DIVIDE(ga.engagement_seconds, ga.sessions) AS avgEngagementSeconds,
  SAFE_DIVIDE(ga.scroll_sessions, ga.sessions) AS scrollRate
FROM sc
LEFT JOIN ga USING (page_host, page_key)
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
    methodology: [
      '対象データ: GA4 `events_*` の page_view イベントを期間で絞り込み、セッション（user_pseudo_id + ga_session_id）内で event_timestamp 順に並べ、各 page_view の「次に閲覧したページ」を求めます。',
      'ページビュー = そのページの page_view 数。セッション = そのページを閲覧したセッション数。',
      '次ページ遷移 = 同一セッション内で次の page_view があり、かつそれが別のパスだった page_view の数。回遊率 = 次ページ遷移 ÷ ページビュー。',
      '離脱率 = 同一セッション内でその page_view の後に page_view が無かった数 ÷ ページビュー（同じページの再読み込みは回遊にも離脱にも含みません）。',
      'GSC プロパティを指定した場合は、そのホストのページのみ対象にします。',
      '抽出条件・並び順: ページビューがしきい値以上のページを、回遊率の高い順（同値ならページビューの多い順）に表示します。',
    ],
    columns: [
      { key: 'page', label: 'ページ', type: 'text' },
      { key: 'pageViews', label: 'ページビュー', type: 'number' },
      { key: 'sessions', label: 'セッション', type: 'number' },
      { key: 'onwardViews', label: '次ページ遷移', type: 'number' },
      { key: 'onwardRate', label: '回遊率', type: 'percent' },
      { key: 'exitRate', label: '離脱率', type: 'percent' },
    ],
    charts: [
      { type: 'bar', title: '回遊率上位ページ', labelKey: 'page', valueKey: 'onwardRate' },
      { type: 'scatter', title: 'ページビューと回遊率の関係', xKey: 'pageViews', yKey: 'onwardRate', labelKey: 'page' },
    ],
    build: ({ project, ga4Dataset, startDate, endDate, site, threshold, limit }) => ({
      query: `
WITH page_views AS (
  SELECT
    event_timestamp,${GA4_EVENT_FIELDS}
  FROM ${ga4EventsTable({ project, ga4Dataset })}
  WHERE ${ga4EventDayFilter({ project, ga4Dataset })}
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
  {
    id: 'discover-hit-profile',
    name: 'Discoverヒットページ分析',
    dataSource: 'SC＋ページ属性',
    insight: 'Discoverで伸びるページの特徴',
    priority: 3,
    thresholdLabel: '最小クリック数',
    defaultThreshold: 10,
    methodology: [
      '対象データ: GSC `searchdata_url_impression` の search_type = DISCOVER 行を、期間・GSC プロパティで絞り込み、URL×日付ごとに集計した上で URL 単位にまとめます。',
      '第1階層: URL のホスト直後のパス要素（例: example.com/blog/post → blog）。無い場合は「(ルート)」。',
      'パス階層数: パスを「/」で区切った要素数。スラッグ長: パス末尾の要素の文字数。',
      '露出日数 = 期間内に表示された日数。CTR = クリック ÷ 表示。1日あたりクリック = クリック ÷ 露出日数。',
      '抽出条件・並び順: クリック合計がしきい値以上の URL を、クリックの多い順に表示します。',
    ],
    columns: [
      { key: 'page', label: 'ページ', type: 'url' },
      { key: 'category', label: '第1階層', type: 'text' },
      { key: 'pathDepth', label: 'パス階層数', type: 'number' },
      { key: 'slugLength', label: 'スラッグ長', type: 'number' },
      { key: 'activeDays', label: '露出日数', type: 'number' },
      { key: 'impressions', label: '表示', type: 'number' },
      { key: 'clicks', label: 'クリック', type: 'number' },
      { key: 'ctr', label: 'CTR', type: 'percent' },
      { key: 'clicksPerDay', label: '1日あたりクリック', type: 'decimal' },
    ],
    charts: [
      { type: 'bar', title: 'Discoverクリック上位ページ', labelKey: 'page', valueKey: 'clicks' },
      { type: 'scatter', title: 'パス階層数とクリックの関係', xKey: 'pathDepth', yKey: 'clicks', labelKey: 'page' },
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
)
SELECT
  url AS page,
  IFNULL(REGEXP_EXTRACT(url, r'^https?://[^/]+/([^/?#]+)'), '(ルート)') AS category,
  ARRAY_LENGTH(SPLIT(TRIM(IFNULL(${pagePath('url')}, '/'), '/'), '/')) AS pathDepth,
  LENGTH(IFNULL(REGEXP_EXTRACT(url, r'([^/?#]+)/?(?:[?#].*)?$'), '')) AS slugLength,
  COUNT(*) AS activeDays,
  SUM(impressions) AS impressions,
  SUM(clicks) AS clicks,
  SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
  SAFE_DIVIDE(SUM(clicks), COUNT(*)) AS clicksPerDay
FROM daily
GROUP BY 1, 2, 3, 4
HAVING clicks >= @threshold
ORDER BY clicks DESC
LIMIT @rowLimit`,
      params: { startDate, endDate, site, threshold, rowLimit: limit },
      types: { startDate: 'STRING', endDate: 'STRING', site: 'STRING', threshold: 'INT64', rowLimit: 'INT64' },
    }),
  },
  {
    id: 'search-demand-surge',
    name: '検索需要急上昇検知',
    dataSource: 'SC',
    insight: '最近急に検索され始めたテーマ（期間を前半・後半に分割して比較）',
    priority: 2,
    thresholdLabel: '後半の最小表示回数',
    defaultThreshold: 50,
    methodology: [
      '対象データ: GSC `searchdata_url_impression` の search_type = WEB 行を期間・GSC プロパティで絞り込み、匿名化クエリ（is_anonymized_query）を除外して検索語ごとに集計します。',
      '期間分割: 指定期間の中央日を境に「前半」「後半」に分け、それぞれの表示・クリックを合計します（日数が奇数の場合は後半が 1 日短くなります）。',
      '表示の増加 = 後半の表示 − 前半の表示。増加率 = 表示の増加 ÷ 前半の表示（前半が 0 の場合は空）。',
      '平均順位 = 期間全体の sum_position ÷ 表示 + 1。',
      '抽出条件・並び順: 後半の表示がしきい値以上で、かつ前半より増えた検索語を、表示の増加が大きい順に表示します。',
    ],
    columns: [
      { key: 'query', label: '検索語', type: 'text' },
      { key: 'recentImpressions', label: '後半の表示', type: 'number' },
      { key: 'previousImpressions', label: '前半の表示', type: 'number' },
      { key: 'impressionsDelta', label: '表示の増加', type: 'number' },
      { key: 'growthRate', label: '増加率', type: 'percent' },
      { key: 'recentClicks', label: '後半のクリック', type: 'number' },
      { key: 'avgPosition', label: '平均順位', type: 'decimal' },
    ],
    charts: [
      { type: 'bar', title: '表示の増加が大きい検索語', labelKey: 'query', valueKey: 'impressionsDelta' },
      {
        type: 'scatter',
        title: '前半の表示と増加率の関係',
        xKey: 'previousImpressions',
        yKey: 'growthRate',
        labelKey: 'query',
      },
    ],
    build: ({ project, gscDataset, startDate, endDate, site, threshold, limit }) => ({
      query: `
WITH agg AS (
  SELECT
    query,
    SUM(IF(data_date >= PARSE_DATE('%Y-%m-%d', @splitDate), impressions, 0)) AS recent_impressions,
    SUM(IF(data_date < PARSE_DATE('%Y-%m-%d', @splitDate), impressions, 0)) AS previous_impressions,
    SUM(IF(data_date >= PARSE_DATE('%Y-%m-%d', @splitDate), clicks, 0)) AS recent_clicks,
    SAFE_DIVIDE(SUM(sum_position), SUM(impressions)) + 1 AS avg_position
  FROM ${urlImpressionTable({ project, gscDataset })}
  WHERE data_date BETWEEN PARSE_DATE('%Y-%m-%d', @startDate) AND PARSE_DATE('%Y-%m-%d', @endDate)
    AND search_type = 'WEB'
    AND (@site IS NULL OR site_url = @site)
    ${QUERY_FILTER}
  GROUP BY query
)
SELECT
  query,
  recent_impressions AS recentImpressions,
  previous_impressions AS previousImpressions,
  recent_impressions - previous_impressions AS impressionsDelta,
  SAFE_DIVIDE(recent_impressions - previous_impressions, NULLIF(previous_impressions, 0)) AS growthRate,
  recent_clicks AS recentClicks,
  avg_position AS avgPosition
FROM agg
WHERE recent_impressions >= @threshold
  AND recent_impressions > previous_impressions
ORDER BY impressionsDelta DESC
LIMIT @rowLimit`,
      params: { startDate, endDate, splitDate: midDate(startDate, endDate), site, threshold, rowLimit: limit },
      types: {
        startDate: 'STRING',
        endDate: 'STRING',
        splitDate: 'STRING',
        site: 'STRING',
        threshold: 'INT64',
        rowLimit: 'INT64',
      },
    }),
  },
  {
    id: 'seo-cannibalization',
    name: 'SEOカニバリゼーション',
    dataSource: 'SC',
    insight: '同じ検索語で複数ページが競合',
    priority: 2,
    thresholdLabel: '最小表示回数',
    defaultThreshold: 100,
    methodology: [
      '対象データ: GSC `searchdata_url_impression` の search_type = WEB 行を期間・GSC プロパティで絞り込み、匿名化クエリを除外して検索語×URL ごとに表示・クリックを合計します。',
      '競合ページ数 = その検索語で表示された URL の数。表示・クリック = その検索語の全 URL 合計。',
      '主ページ = 検索語内で表示が最も多い URL、競合ページ = 2 番目に多い URL。表示比率 = 各 URL の表示 ÷ 検索語全体の表示。',
      '抽出条件: 競合ページ数が 2 以上で、検索語全体の表示がしきい値以上のもの。',
      '並び順: 競合ページ（2 位 URL）の表示が多い順。',
    ],
    columns: [
      { key: 'query', label: '検索語', type: 'text' },
      { key: 'competingPages', label: '競合ページ数', type: 'number' },
      { key: 'impressions', label: '表示', type: 'number' },
      { key: 'clicks', label: 'クリック', type: 'number' },
      { key: 'topPage', label: '主ページ', type: 'url' },
      { key: 'topPageShare', label: '主ページの表示比率', type: 'percent' },
      { key: 'runnerUpPage', label: '競合ページ', type: 'url' },
      { key: 'runnerUpShare', label: '競合ページの表示比率', type: 'percent' },
    ],
    charts: [
      { type: 'bar', title: '競合ページの表示が多い検索語', labelKey: 'query', valueKey: 'runnerUpShare' },
      {
        type: 'scatter',
        title: '表示と競合ページ数の関係',
        xKey: 'impressions',
        yKey: 'competingPages',
        labelKey: 'query',
      },
    ],
    build: ({ project, gscDataset, startDate, endDate, site, threshold, limit }) => ({
      query: `
WITH pairs AS (
  SELECT query, url, SUM(impressions) AS impressions, SUM(clicks) AS clicks
  FROM ${urlImpressionTable({ project, gscDataset })}
  WHERE data_date BETWEEN PARSE_DATE('%Y-%m-%d', @startDate) AND PARSE_DATE('%Y-%m-%d', @endDate)
    AND search_type = 'WEB'
    AND (@site IS NULL OR site_url = @site)
    ${QUERY_FILTER}
  GROUP BY query, url
),
ranked AS (
  SELECT
    query,
    url,
    impressions,
    ROW_NUMBER() OVER (PARTITION BY query ORDER BY impressions DESC, url) AS rank_in_query,
    SUM(impressions) OVER (PARTITION BY query) AS query_impressions,
    SUM(clicks) OVER (PARTITION BY query) AS query_clicks,
    COUNT(*) OVER (PARTITION BY query) AS competing_pages
  FROM pairs
)
SELECT
  query,
  ANY_VALUE(competing_pages) AS competingPages,
  ANY_VALUE(query_impressions) AS impressions,
  ANY_VALUE(query_clicks) AS clicks,
  ANY_VALUE(IF(rank_in_query = 1, url, NULL)) AS topPage,
  ANY_VALUE(IF(rank_in_query = 1, SAFE_DIVIDE(impressions, query_impressions), NULL)) AS topPageShare,
  ANY_VALUE(IF(rank_in_query = 2, url, NULL)) AS runnerUpPage,
  ANY_VALUE(IF(rank_in_query = 2, SAFE_DIVIDE(impressions, query_impressions), NULL)) AS runnerUpShare,
  MAX(IF(rank_in_query = 2, impressions, 0)) AS runner_up_impressions
FROM ranked
GROUP BY query
HAVING competingPages >= 2 AND impressions >= @threshold
ORDER BY runner_up_impressions DESC
LIMIT @rowLimit`,
      params: { startDate, endDate, site, threshold, rowLimit: limit },
      types: { startDate: 'STRING', endDate: 'STRING', site: 'STRING', threshold: 'INT64', rowLimit: 'INT64' },
    }),
  },
  {
    id: 'page-decay',
    name: 'ページ劣化・リライト候補',
    dataSource: 'SC×GA4',
    insight: '検索流入が落ち始めたページ（期間を前半・後半に分割して比較）',
    priority: 2,
    thresholdLabel: '前半の最小クリック数',
    defaultThreshold: 20,
    methodology: [
      'GSC 側: `searchdata_url_impression` の search_type = WEB 行を期間・GSC プロパティで絞り込み、指定期間の中央日を境に「前半」「後半」に分けてページごとにクリック・表示・sum_position を合計します。',
      '減少数 = 前半のクリック − 後半のクリック。変化率 = (後半 − 前半) ÷ 前半（減少ならマイナス）。',
      '前半 / 後半の平均順位 = 各期間の sum_position ÷ 表示 + 1。',
      'GA4 側: `events_*` を期間全体で集計し、セッション（user_pseudo_id + ga_session_id）数と、エンゲージメント率（session_engaged = 1 のセッション ÷ セッション）を求めます。',
      '結合: ホストとパスを正規化して GSC 側を基準に GA4 側を LEFT JOIN します。',
      '抽出条件・並び順: 前半のクリックがしきい値以上で、後半のクリックが前半より少ないページを、減少数の大きい順に表示します。',
    ],
    columns: [
      { key: 'page', label: 'ページ', type: 'text' },
      { key: 'previousClicks', label: '前半のクリック', type: 'number' },
      { key: 'recentClicks', label: '後半のクリック', type: 'number' },
      { key: 'clicksDropped', label: '減少数', type: 'number' },
      { key: 'changeRate', label: '変化率', type: 'percent' },
      { key: 'previousAvgPosition', label: '前半の平均順位', type: 'decimal' },
      { key: 'recentAvgPosition', label: '後半の平均順位', type: 'decimal' },
      { key: 'sessions', label: 'セッション', type: 'number' },
      { key: 'engagementRate', label: 'エンゲージメント率', type: 'percent' },
    ],
    charts: [
      { type: 'bar', title: 'クリック減少が大きいページ', labelKey: 'page', valueKey: 'clicksDropped' },
      {
        type: 'scatter',
        title: '前半のクリックと変化率の関係',
        xKey: 'previousClicks',
        yKey: 'changeRate',
        labelKey: 'page',
      },
    ],
    build: (options) => buildPeriodComparison({ ...options, direction: 'down' }),
  },
  {
    id: 'search-read-onward-funnel',
    name: '検索→読了→回遊ファネル',
    dataSource: 'SC×GA4',
    insight: 'SEO流入の「質」',
    priority: 2,
    thresholdLabel: '最小検索クリック数',
    defaultThreshold: 20,
    methodology: [
      'GSC 側: `searchdata_url_impression` の search_type = WEB 行を期間・GSC プロパティで絞り込み、ページごとに検索クリックを合計します。',
      'GA4 側: `events_*` のうち、セッションの最終クリック参照元 medium が organic のセッションのみを対象にします（自然検索セッション）。',
      '読了セッション = そのページで scroll イベントが発生、または session_engaged = 1 だったセッション数。回遊セッション = そのページの page_view の後、同一セッション内で別ページの page_view があったセッション数。',
      'クリック→セッション率 = 自然検索セッション ÷ 検索クリック。読了率 = 読了セッション ÷ 自然検索セッション。回遊率 = 回遊セッション ÷ 自然検索セッション。',
      '結合: ホストとパスを正規化して GSC 側を基準に GA4 側を LEFT JOIN します。',
      '抽出条件・並び順: 検索クリックがしきい値以上のページを、検索クリックの多い順に表示します。',
    ],
    columns: [
      { key: 'page', label: 'ページ', type: 'text' },
      { key: 'searchClicks', label: '検索クリック', type: 'number' },
      { key: 'sessions', label: '自然検索セッション', type: 'number' },
      { key: 'readSessions', label: '読了セッション', type: 'number' },
      { key: 'onwardSessions', label: '回遊セッション', type: 'number' },
      { key: 'arrivalRate', label: 'クリック→セッション率', type: 'percent' },
      { key: 'readRate', label: '読了率', type: 'percent' },
      { key: 'onwardRate', label: '回遊率', type: 'percent' },
    ],
    charts: [
      { type: 'bar', title: '読了率上位ページ', labelKey: 'page', valueKey: 'readRate' },
      { type: 'scatter', title: '読了率と回遊率の関係', xKey: 'readRate', yKey: 'onwardRate', labelKey: 'page' },
    ],
    build: ({ project, ga4Dataset, gscDataset, startDate, endDate, site, threshold, limit }) => ({
      query: `${NORM_PATH_UDF}
WITH events AS (
  SELECT
    event_name,
    event_timestamp,${GA4_EVENT_FIELDS},
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'session_engaged') AS session_engaged
  FROM ${ga4EventsTable({ project, ga4Dataset })}
  WHERE ${ga4EventDayFilter({ project, ga4Dataset })}
    AND ${ORGANIC_SESSION_FILTER}
),
page_views AS (
  SELECT
    session_key,
    page_path,
    page_host,
    LEAD(page_path) OVER (PARTITION BY session_key ORDER BY event_timestamp) AS next_path
  FROM events
  WHERE event_name = 'page_view' AND page_path IS NOT NULL
),
session_pages AS (
  SELECT
    session_key,
    normPath(page_path) AS page_key,
    page_host,
    LOGICAL_OR(next_path IS NOT NULL AND next_path != page_path) AS onward
  FROM page_views
  GROUP BY session_key, page_key, page_host
),
session_reads AS (
  SELECT
    session_key,
    normPath(page_path) AS page_key,
    page_host,
    LOGICAL_OR(event_name = 'scroll' OR session_engaged = '1') AS did_read
  FROM events
  WHERE page_path IS NOT NULL
  GROUP BY session_key, page_key, page_host
),
ga AS (
  SELECT
    session_pages.page_key,
    session_pages.page_host,
    COUNT(*) AS sessions,
    COUNTIF(IFNULL(session_reads.did_read, FALSE)) AS read_sessions,
    COUNTIF(session_pages.onward) AS onward_sessions
  FROM session_pages
  LEFT JOIN session_reads USING (session_key, page_key, page_host)
  GROUP BY page_key, page_host
),
sc_raw AS (
  SELECT
    ${pagePath('url')} AS page_path,
    ${GSC_PAGE_HOST_EXPR} AS page_host,
    SUM(clicks) AS search_clicks
  FROM ${urlImpressionTable({ project, gscDataset })}
  WHERE data_date BETWEEN PARSE_DATE('%Y-%m-%d', @startDate) AND PARSE_DATE('%Y-%m-%d', @endDate)
    AND search_type = 'WEB'
    AND (@site IS NULL OR site_url = @site)
  GROUP BY page_path, page_host
),
sc AS (
  SELECT normPath(page_path) AS page_key, page_host, SUM(search_clicks) AS search_clicks
  FROM sc_raw
  GROUP BY page_key, page_host
)
SELECT
  CONCAT(sc.page_host, sc.page_key) AS page,
  sc.search_clicks AS searchClicks,
  ga.sessions,
  ga.read_sessions AS readSessions,
  ga.onward_sessions AS onwardSessions,
  SAFE_DIVIDE(ga.sessions, sc.search_clicks) AS arrivalRate,
  SAFE_DIVIDE(ga.read_sessions, ga.sessions) AS readRate,
  SAFE_DIVIDE(ga.onward_sessions, ga.sessions) AS onwardRate
FROM sc
LEFT JOIN ga USING (page_host, page_key)
WHERE sc.search_clicks >= @threshold
ORDER BY sc.search_clicks DESC
LIMIT @rowLimit`,
      params: {
        startDate,
        endDate,
        startSuffix: toSuffix(startDate),
        endSuffix: toSuffix(endDate),
        site,
        threshold,
        rowLimit: limit,
      },
      types: {
        startDate: 'STRING',
        endDate: 'STRING',
        startSuffix: 'STRING',
        endSuffix: 'STRING',
        site: 'STRING',
        threshold: 'INT64',
        rowLimit: 'INT64',
      },
    }),
  },
  {
    id: 'repeat-visitors',
    name: 'リピーター創出力',
    dataSource: 'GA4',
    insight: '新規読者を再訪させるページ',
    priority: 2,
    thresholdLabel: '最小新規ユーザー数',
    defaultThreshold: 30,
    methodology: [
      '対象データ: GA4 `events_*` を期間で絞り込み、user_pseudo_id ごとに期間内のセッション数と、期間内で最初のセッションを求めます。',
      '新規ユーザー = 期間内の最初のセッションでそのページを page_view したユーザー数（期間開始前の訪問は考慮しません）。',
      '再訪ユーザー = 新規ユーザーのうち、期間内にセッションが 2 回以上あったユーザー数。再訪率 = 再訪ユーザー ÷ 新規ユーザー。',
      '平均セッション数 = 新規ユーザーの期間内セッション数の合計 ÷ 新規ユーザー数。',
      'GSC プロパティを指定した場合は、そのホストのページのみ対象にします。',
      '抽出条件・並び順: 新規ユーザーがしきい値以上のページを、再訪率の高い順（同値なら新規ユーザーの多い順）に表示します。',
    ],
    columns: [
      { key: 'page', label: 'ページ', type: 'text' },
      { key: 'newUsers', label: '新規ユーザー', type: 'number' },
      { key: 'repeatUsers', label: '再訪ユーザー', type: 'number' },
      { key: 'repeatRate', label: '再訪率', type: 'percent' },
      { key: 'avgSessionsPerUser', label: '平均セッション数', type: 'decimal' },
    ],
    charts: [
      { type: 'bar', title: '再訪率上位ページ', labelKey: 'page', valueKey: 'repeatRate' },
      { type: 'scatter', title: '新規ユーザーと再訪率の関係', xKey: 'newUsers', yKey: 'repeatRate', labelKey: 'page' },
    ],
    build: ({ project, ga4Dataset, startDate, endDate, site, threshold, limit }) => ({
      query: `
WITH events AS (
  SELECT
    user_pseudo_id,
    event_name,
    event_timestamp,${GA4_EVENT_FIELDS}
  FROM ${ga4EventsTable({ project, ga4Dataset })}
  WHERE ${ga4EventDayFilter({ project, ga4Dataset })}
),
user_stats AS (
  SELECT
    user_pseudo_id,
    COUNT(DISTINCT session_key) AS sessions,
    ARRAY_AGG(session_key ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)] AS first_session
  FROM events
  GROUP BY user_pseudo_id
),
first_session_pages AS (
  SELECT DISTINCT
    events.user_pseudo_id,
    events.page_path,
    events.page_host,
    user_stats.sessions
  FROM events
  JOIN user_stats USING (user_pseudo_id)
  WHERE events.event_name = 'page_view'
    AND events.session_key = user_stats.first_session
    AND events.page_path IS NOT NULL
)
SELECT
  page_path AS page,
  COUNT(DISTINCT user_pseudo_id) AS newUsers,
  COUNT(DISTINCT IF(sessions > 1, user_pseudo_id, NULL)) AS repeatUsers,
  SAFE_DIVIDE(
    COUNT(DISTINCT IF(sessions > 1, user_pseudo_id, NULL)),
    COUNT(DISTINCT user_pseudo_id)
  ) AS repeatRate,
  SAFE_DIVIDE(SUM(sessions), COUNT(DISTINCT user_pseudo_id)) AS avgSessionsPerUser
FROM first_session_pages
WHERE @host IS NULL OR page_host = @host
GROUP BY page
HAVING newUsers >= @threshold
ORDER BY repeatRate DESC, newUsers DESC
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
  {
    id: 'page-update-effect',
    name: 'ページ更新効果測定',
    dataSource: 'SC×GA4',
    insight: 'リライト前後の改善度（期間を前半・後半に分割して比較）',
    priority: 2,
    thresholdLabel: '前半の最小クリック数',
    defaultThreshold: 20,
    methodology: [
      'GSC 側: `searchdata_url_impression` の search_type = WEB 行を期間・GSC プロパティで絞り込み、指定期間の中央日を境に「前半」「後半」に分けてページごとにクリック・表示・sum_position を合計します。リライト日が中央日になるように期間を指定してください。',
      '増加数 = 後半のクリック − 前半のクリック。変化率 = 増加数 ÷ 前半のクリック。',
      '前半 / 後半の平均順位 = 各期間の sum_position ÷ 表示 + 1。順位改善 = 前半の平均順位 − 後半の平均順位（プラスなら改善）。',
      'GA4 側: `events_*` を期間全体で集計し、セッション（user_pseudo_id + ga_session_id）数と、エンゲージメント率（session_engaged = 1 のセッション ÷ セッション）を求めます。',
      '結合: ホストとパスを正規化して GSC 側を基準に GA4 側を LEFT JOIN します。',
      '抽出条件・並び順: 前半のクリックがしきい値以上で、後半のクリックが前半より多いページを、増加数の大きい順に表示します。',
    ],
    columns: [
      { key: 'page', label: 'ページ', type: 'text' },
      { key: 'previousClicks', label: '前半のクリック', type: 'number' },
      { key: 'recentClicks', label: '後半のクリック', type: 'number' },
      { key: 'clicksGained', label: '増加数', type: 'number' },
      { key: 'changeRate', label: '変化率', type: 'percent' },
      { key: 'previousAvgPosition', label: '前半の平均順位', type: 'decimal' },
      { key: 'recentAvgPosition', label: '後半の平均順位', type: 'decimal' },
      { key: 'positionImprovement', label: '順位改善', type: 'decimal' },
      { key: 'sessions', label: 'セッション', type: 'number' },
      { key: 'engagementRate', label: 'エンゲージメント率', type: 'percent' },
    ],
    charts: [
      { type: 'bar', title: 'クリック増加が大きいページ', labelKey: 'page', valueKey: 'clicksGained' },
      {
        type: 'scatter',
        title: '順位改善とクリック増加の関係',
        xKey: 'positionImprovement',
        yKey: 'clicksGained',
        labelKey: 'page',
      },
    ],
    build: (options) => buildPeriodComparison({ ...options, direction: 'up' }),
  },
  {
    id: 'search-intent-cluster',
    name: '検索意図クラスタ分析',
    dataSource: 'SC',
    insight: 'サイトが獲得している検索需要の構造',
    priority: 1,
    thresholdLabel: '最小表示回数',
    defaultThreshold: 0,
    methodology: [
      '対象データ: GSC `searchdata_url_impression` の search_type = WEB 行を期間・GSC プロパティで絞り込み、匿名化クエリを除外して検索語ごとに表示・クリック・sum_position を合計します。',
      '分類ルール（上から順に最初に一致したもの）: 「指名」= GSC プロパティのホスト先頭要素（ブランド名）を含む（プロパティ未指定時は判定しません） / 「情報収集」= とは・意味・方法・やり方・理由・原因・how・why / 「比較検討」= おすすめ・比較・ランキング・違い・口コミ・評判・レビュー・vs / 「取引・行動」= 予約・料金・価格・値段・購入・申し込(申込)・クーポン・割引・空室・プラン / それ以外は「その他」。',
      '検索語数 = 各クラスタに含まれる検索語の数。表示シェア = クラスタの表示 ÷ 全クラスタの表示合計。CTR = クリック ÷ 表示。平均順位 = sum_position ÷ 表示 + 1。',
      '抽出条件・並び順: 表示がしきい値以上のクラスタを、表示の多い順に表示します。',
    ],
    columns: [
      { key: 'intent', label: '検索意図', type: 'text' },
      { key: 'queries', label: '検索語数', type: 'number' },
      { key: 'impressions', label: '表示', type: 'number' },
      { key: 'clicks', label: 'クリック', type: 'number' },
      { key: 'impressionShare', label: '表示シェア', type: 'percent' },
      { key: 'ctr', label: 'CTR', type: 'percent' },
      { key: 'avgPosition', label: '平均順位', type: 'decimal' },
    ],
    charts: [
      { type: 'bar', title: '検索意図別の表示', labelKey: 'intent', valueKey: 'impressions' },
      { type: 'scatter', title: '平均順位とCTRの関係', xKey: 'avgPosition', yKey: 'ctr', labelKey: 'intent' },
    ],
    build: ({ project, gscDataset, startDate, endDate, site, threshold, limit }) => ({
      query: `
WITH queries AS (
  SELECT query, SUM(impressions) AS impressions, SUM(clicks) AS clicks, SUM(sum_position) AS position_sum
  FROM ${urlImpressionTable({ project, gscDataset })}
  WHERE data_date BETWEEN PARSE_DATE('%Y-%m-%d', @startDate) AND PARSE_DATE('%Y-%m-%d', @endDate)
    AND search_type = 'WEB'
    AND (@site IS NULL OR site_url = @site)
    ${QUERY_FILTER}
  GROUP BY query
),
classified AS (
  SELECT
    CASE
      WHEN @brand IS NOT NULL AND STRPOS(LOWER(query), @brand) > 0 THEN '指名'
      WHEN REGEXP_CONTAINS(query, r'(とは|意味|方法|やり方|理由|原因|how|why)') THEN '情報収集'
      WHEN REGEXP_CONTAINS(query, r'(おすすめ|比較|ランキング|違い|口コミ|評判|レビュー|vs)') THEN '比較検討'
      WHEN REGEXP_CONTAINS(query, r'(予約|料金|価格|値段|購入|申し込|申込|クーポン|割引|空室|プラン)') THEN '取引・行動'
      ELSE 'その他'
    END AS intent,
    impressions,
    clicks,
    position_sum
  FROM queries
),
grouped AS (
  SELECT
    intent,
    COUNT(*) AS queries,
    SUM(impressions) AS impressions,
    SUM(clicks) AS clicks,
    SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
    SAFE_DIVIDE(SUM(position_sum), SUM(impressions)) + 1 AS avg_position
  FROM classified
  GROUP BY intent
)
SELECT
  intent,
  queries,
  impressions,
  clicks,
  SAFE_DIVIDE(impressions, SUM(impressions) OVER ()) AS impressionShare,
  ctr,
  avg_position AS avgPosition
FROM grouped
WHERE impressions >= @threshold
ORDER BY impressions DESC
LIMIT @rowLimit`,
      params: { startDate, endDate, site, brand: brandFromSite(site), threshold, rowLimit: limit },
      types: {
        startDate: 'STRING',
        endDate: 'STRING',
        site: 'STRING',
        brand: 'STRING',
        threshold: 'INT64',
        rowLimit: 'INT64',
      },
    }),
  },
  {
    id: 'ga4-page-overview',
    name: 'GA4 ページ別アクセス数（基本）',
    dataSource: 'GA4',
    insight: 'GA4 データセットに入っているページ別の素データ',
    priority: 1,
    thresholdLabel: '最小ページビュー',
    defaultThreshold: 0,
    methodology: [
      '対象データ: GA4 `events_*` の全イベントを期間で絞り込み、page_location のホスト＋パスごとに集計します（結合・正規化なし）。',
      'ページビュー = page_view イベント数。セッション = user_pseudo_id + ga_session_id の組み合わせの数。ユーザー = user_pseudo_id の数。',
      '平均滞在(秒) = engagement_time_msec の合計 ÷ 1000 ÷ セッション数。初回 / 最終計測日 = そのページのイベントが記録された最初と最後の日付。',
      'GSC プロパティを指定した場合は、そのホストのページのみ対象にします。',
      '抽出条件・並び順: ページビューがしきい値以上のページを、ページビューの多い順に表示します。',
    ],
    columns: [
      { key: 'page', label: 'ページ', type: 'text' },
      { key: 'pageViews', label: 'ページビュー', type: 'number' },
      { key: 'sessions', label: 'セッション', type: 'number' },
      { key: 'users', label: 'ユーザー', type: 'number' },
      { key: 'avgEngagementSeconds', label: '平均滞在(秒)', type: 'decimal' },
      { key: 'firstDate', label: '初回計測日', type: 'text' },
      { key: 'lastDate', label: '最終計測日', type: 'text' },
    ],
    charts: [{ type: 'bar', title: 'ページビュー上位ページ', labelKey: 'page', valueKey: 'pageViews' }],
    build: ({ project, ga4Dataset, startDate, endDate, site, threshold, limit }) => ({
      query: `
WITH events AS (
  SELECT
    ${GA4_EVENT_DAY_EXPR} AS event_day,
    event_name,
    user_pseudo_id,${GA4_EVENT_FIELDS},
    IFNULL((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'engagement_time_msec'), 0) AS engagement_msec
  FROM ${ga4EventsTable({ project, ga4Dataset })}
  WHERE ${ga4EventDayFilter({ project, ga4Dataset })}
)
SELECT
  CONCAT(IFNULL(page_host, ''), page_path) AS page,
  COUNTIF(event_name = 'page_view') AS pageViews,
  COUNT(DISTINCT session_key) AS sessions,
  COUNT(DISTINCT user_pseudo_id) AS users,
  SAFE_DIVIDE(SUM(engagement_msec) / 1000, COUNT(DISTINCT session_key)) AS avgEngagementSeconds,
  FORMAT_DATE('%Y-%m-%d', PARSE_DATE('%Y%m%d', MIN(event_day))) AS firstDate,
  FORMAT_DATE('%Y-%m-%d', PARSE_DATE('%Y%m%d', MAX(event_day))) AS lastDate
FROM events
WHERE page_path IS NOT NULL
  AND (@host IS NULL OR page_host = @host)
GROUP BY page
HAVING pageViews >= @threshold
ORDER BY pageViews DESC
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
  {
    id: 'ga4-event-overview',
    name: 'GA4 イベントログ（基本）',
    dataSource: 'GA4',
    insight: 'GA4 データセットに入っているイベントの種類と件数',
    priority: 1,
    thresholdLabel: '最小イベント数',
    defaultThreshold: 0,
    methodology: [
      '対象データ: GA4 `events_*` の全イベントを期間で絞り込み、event_name ごとに集計します（GSC プロパティによる絞り込みはありません）。',
      'イベント数 = 行数。セッション = user_pseudo_id + ga_session_id の組み合わせの数。ユーザー = user_pseudo_id の数。',
      '計測日数 = そのイベントが記録された日数。初回 / 最終計測日 = 記録された最初と最後の日付。',
      '抽出条件・並び順: イベント数がしきい値以上のイベントを、イベント数の多い順に表示します。',
    ],
    columns: [
      { key: 'eventName', label: 'イベント名', type: 'text' },
      { key: 'events', label: 'イベント数', type: 'number' },
      { key: 'sessions', label: 'セッション', type: 'number' },
      { key: 'users', label: 'ユーザー', type: 'number' },
      { key: 'activeDays', label: '計測日数', type: 'number' },
      { key: 'firstDate', label: '初回計測日', type: 'text' },
      { key: 'lastDate', label: '最終計測日', type: 'text' },
    ],
    charts: [{ type: 'bar', title: 'イベント数上位', labelKey: 'eventName', valueKey: 'events' }],
    build: ({ project, ga4Dataset, startDate, endDate, threshold, limit }) => ({
      query: `
WITH events AS (
  SELECT
    ${GA4_EVENT_DAY_EXPR} AS event_day,
    event_name,
    user_pseudo_id,
    CONCAT(
      user_pseudo_id,
      '-',
      CAST(IFNULL((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id'), 0) AS STRING)
    ) AS session_key
  FROM ${ga4EventsTable({ project, ga4Dataset })}
  WHERE ${ga4EventDayFilter({ project, ga4Dataset })}
)
SELECT
  event_name AS eventName,
  COUNT(*) AS events,
  COUNT(DISTINCT session_key) AS sessions,
  COUNT(DISTINCT user_pseudo_id) AS users,
  COUNT(DISTINCT event_day) AS activeDays,
  FORMAT_DATE('%Y-%m-%d', PARSE_DATE('%Y%m%d', MIN(event_day))) AS firstDate,
  FORMAT_DATE('%Y-%m-%d', PARSE_DATE('%Y%m%d', MAX(event_day))) AS lastDate
FROM events
GROUP BY eventName
HAVING events >= @threshold
ORDER BY events DESC
LIMIT @rowLimit`,
      params: {
        startSuffix: toSuffix(startDate),
        endSuffix: toSuffix(endDate),
        threshold,
        rowLimit: limit,
      },
      types: {
        startSuffix: 'STRING',
        endSuffix: 'STRING',
        threshold: 'INT64',
        rowLimit: 'INT64',
      },
    }),
  },
  {
    id: 'ga4-daily-traffic',
    name: 'GA4 日別アクセス数（基本）',
    dataSource: 'GA4',
    insight: 'GA4 データセットの日別のセッション・ユーザー数',
    priority: 1,
    thresholdLabel: '最小セッション',
    defaultThreshold: 0,
    methodology: [
      '対象データ: GA4 `events_*` の全イベントを期間で絞り込み、テーブル名の日付（events_YYYYMMDD）ごとに集計します。',
      'ページビュー = page_view イベント数。セッション = user_pseudo_id + ga_session_id の組み合わせの数。ユーザー = user_pseudo_id の数。ページ数 = page_location のパスの種類数。',
      'エンゲージメント率 = session_engaged = 1 のイベントを含むセッション数 ÷ セッション数。',
      'GSC プロパティを指定した場合は、そのホストのイベント（page_location を持たないイベントも含む）のみ対象にします。',
      '抽出条件・並び順: セッションがしきい値以上の日を、日付の新しい順に表示します。',
    ],
    columns: [
      { key: 'date', label: '日付', type: 'text' },
      { key: 'pageViews', label: 'ページビュー', type: 'number' },
      { key: 'sessions', label: 'セッション', type: 'number' },
      { key: 'users', label: 'ユーザー', type: 'number' },
      { key: 'pages', label: 'ページ数', type: 'number' },
      { key: 'engagementRate', label: 'エンゲージメント率', type: 'percent' },
    ],
    charts: [{ type: 'bar', title: '日別セッション', labelKey: 'date', valueKey: 'sessions' }],
    build: ({ project, ga4Dataset, startDate, endDate, site, threshold, limit }) => ({
      query: `
WITH events AS (
  SELECT
    ${GA4_EVENT_DAY_EXPR} AS event_day,
    event_name,
    user_pseudo_id,${GA4_EVENT_FIELDS},
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'session_engaged') AS session_engaged
  FROM ${ga4EventsTable({ project, ga4Dataset })}
  WHERE ${ga4EventDayFilter({ project, ga4Dataset })}
)
SELECT
  FORMAT_DATE('%Y-%m-%d', PARSE_DATE('%Y%m%d', event_day)) AS date,
  COUNTIF(event_name = 'page_view') AS pageViews,
  COUNT(DISTINCT session_key) AS sessions,
  COUNT(DISTINCT user_pseudo_id) AS users,
  COUNT(DISTINCT page_path) AS pages,
  SAFE_DIVIDE(
    COUNT(DISTINCT IF(session_engaged = '1', session_key, NULL)),
    COUNT(DISTINCT session_key)
  ) AS engagementRate
FROM events
WHERE @host IS NULL OR page_host = @host OR page_host IS NULL
GROUP BY event_day
HAVING sessions >= @threshold
ORDER BY date DESC
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
  {
    id: 'gsc-daily-queries',
    name: 'GSC 日別検索キーワード（基本）',
    dataSource: 'SC',
    insight: 'Search Console データセットの日別・検索語別の素データ',
    priority: 1,
    thresholdLabel: '最小表示回数',
    defaultThreshold: 0,
    methodology: [
      '対象データ: GSC `searchdata_url_impression` を期間・GSC プロパティで絞り込み（全検索タイプ）、匿名化クエリを除外して日付×検索語ごとに合計します。',
      'CTR = クリック ÷ 表示。平均順位 = sum_position ÷ 表示 + 1。ページ数 = その日にその検索語で表示された URL の数。',
      '抽出条件・並び順: 表示がしきい値以上の行を、日付の新しい順・表示の多い順に表示します。',
    ],
    columns: [
      { key: 'date', label: '日付', type: 'text' },
      { key: 'query', label: '検索キーワード', type: 'text' },
      { key: 'impressions', label: '表示', type: 'number' },
      { key: 'clicks', label: 'クリック', type: 'number' },
      { key: 'ctr', label: 'CTR', type: 'percent' },
      { key: 'avgPosition', label: '平均順位', type: 'decimal' },
      { key: 'pages', label: 'ページ数', type: 'number' },
    ],
    charts: [{ type: 'bar', title: '表示上位キーワード', labelKey: 'query', valueKey: 'impressions' }],
    build: ({ project, gscDataset, startDate, endDate, site, threshold, limit }) => ({
      query: `
SELECT
  FORMAT_DATE('%Y-%m-%d', data_date) AS date,
  query,
  SUM(impressions) AS impressions,
  SUM(clicks) AS clicks,
  SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
  SAFE_DIVIDE(SUM(sum_position), SUM(impressions)) + 1 AS avgPosition,
  COUNT(DISTINCT url) AS pages
FROM ${urlImpressionTable({ project, gscDataset })}
WHERE data_date BETWEEN PARSE_DATE('%Y-%m-%d', @startDate) AND PARSE_DATE('%Y-%m-%d', @endDate)
  AND (@site IS NULL OR site_url = @site)
  ${QUERY_FILTER}
GROUP BY date, query
HAVING impressions >= @threshold
ORDER BY date DESC, impressions DESC
LIMIT @rowLimit`,
      params: { startDate, endDate, site, threshold, rowLimit: limit },
      types: {
        startDate: 'STRING',
        endDate: 'STRING',
        site: 'STRING',
        threshold: 'INT64',
        rowLimit: 'INT64',
      },
    }),
  },
  {
    id: 'gsc-daily-summary',
    name: 'GSC 日別サマリー（基本）',
    dataSource: 'SC',
    insight: 'Search Console データセットの日別の総表示・クリック',
    priority: 1,
    thresholdLabel: '最小表示回数',
    defaultThreshold: 0,
    methodology: [
      '対象データ: GSC `searchdata_url_impression` を期間・GSC プロパティで絞り込み（全検索タイプ・匿名化クエリ含む）、日付ごとに合計します。',
      'CTR = クリック ÷ 表示。平均順位 = sum_position ÷ 表示 + 1。ページ数 = 表示された URL の数。検索語数 = 匿名化されていない検索語の数。検索タイプ = その日に含まれる search_type の一覧。',
      '抽出条件・並び順: 表示がしきい値以上の日を、日付の新しい順に表示します。',
    ],
    columns: [
      { key: 'date', label: '日付', type: 'text' },
      { key: 'impressions', label: '表示', type: 'number' },
      { key: 'clicks', label: 'クリック', type: 'number' },
      { key: 'ctr', label: 'CTR', type: 'percent' },
      { key: 'avgPosition', label: '平均順位', type: 'decimal' },
      { key: 'pages', label: 'ページ数', type: 'number' },
      { key: 'queries', label: '検索語数', type: 'number' },
      { key: 'searchTypes', label: '検索タイプ', type: 'text' },
    ],
    charts: [{ type: 'bar', title: '日別クリック', labelKey: 'date', valueKey: 'clicks' }],
    build: ({ project, gscDataset, startDate, endDate, site, threshold, limit }) => ({
      query: `
SELECT
  FORMAT_DATE('%Y-%m-%d', data_date) AS date,
  SUM(impressions) AS impressions,
  SUM(clicks) AS clicks,
  SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
  SAFE_DIVIDE(SUM(sum_position), SUM(impressions)) + 1 AS avgPosition,
  COUNT(DISTINCT url) AS pages,
  COUNT(DISTINCT query) AS queries,
  STRING_AGG(DISTINCT search_type ORDER BY search_type) AS searchTypes
FROM ${urlImpressionTable({ project, gscDataset })}
WHERE data_date BETWEEN PARSE_DATE('%Y-%m-%d', @startDate) AND PARSE_DATE('%Y-%m-%d', @endDate)
  AND (@site IS NULL OR site_url = @site)
GROUP BY date
HAVING impressions >= @threshold
ORDER BY date DESC
LIMIT @rowLimit`,
      params: { startDate, endDate, site, threshold, rowLimit: limit },
      types: {
        startDate: 'STRING',
        endDate: 'STRING',
        site: 'STRING',
        threshold: 'INT64',
        rowLimit: 'INT64',
      },
    }),
  },
];

function withPageTitleColumn(report) {
  const pageIndex = report.columns.findIndex((column) => column.key === 'page');
  if (pageIndex < 0) {
    return report;
  }
  const columns = [...report.columns];
  columns.splice(pageIndex + 1, 0, { key: 'pageTitle', label: 'ページタイトル', type: 'text' });
  return { ...report, columns };
}

export const REPORTS = REPORT_DEFINITIONS.map(withPageTitleColumn);

export function buildPageTitlesQuery({ project, ga4Dataset, startDate, endDate, pageKeys }) {
  assertProjectId(project);
  assertDatasetId(ga4Dataset, 'ga4Dataset');
  assertDate(startDate, 'startDate');
  assertDate(endDate, 'endDate');
  return {
    query: `${NORM_PATH_UDF}
WITH page_views AS (
  SELECT
    ${pagePath(PAGE_LOCATION_EXPR)} AS page_path,
    ${normalizedHost(pageHost(PAGE_LOCATION_EXPR))} AS page_host,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_title') AS page_title
  FROM ${ga4EventsTable({ project, ga4Dataset })}
  WHERE ${ga4EventDayFilter({ project, ga4Dataset })}
    AND event_name = 'page_view'
),
title_counts AS (
  SELECT page_host, normPath(page_path) AS page_key, page_title, COUNT(*) AS views
  FROM page_views
  WHERE page_path IS NOT NULL AND page_title IS NOT NULL AND page_title != ''
  GROUP BY page_host, page_key, page_title
)
SELECT
  page_host AS pageHost,
  page_key AS pageKey,
  ARRAY_AGG(page_title ORDER BY views DESC LIMIT 1)[SAFE_OFFSET(0)] AS pageTitle
FROM title_counts
WHERE page_key IN UNNEST(@pageKeys)
GROUP BY page_host, page_key`,
    params: {
      startSuffix: toSuffix(startDate),
      endSuffix: toSuffix(endDate),
      pageKeys,
    },
    types: {
      startSuffix: 'STRING',
      endSuffix: 'STRING',
      pageKeys: ['STRING'],
    },
  };
}

export function reportCatalog() {
  return REPORTS.map(
    ({ id, name, dataSource, insight, priority, thresholdLabel, defaultThreshold, methodology, columns, charts }) => ({
      id,
      name,
      dataSource,
      insight,
      priority,
      thresholdLabel,
      defaultThreshold,
      methodology,
      columns,
      charts,
    }),
  );
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
