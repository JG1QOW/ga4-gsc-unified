import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createBigQueryClient, ValidationError } from './bigquery.js';
import { buildReportQuery, buildSitesQuery, reportCatalog } from './reports.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT) || 8080;

const bigquery = createBigQueryClient();

const app = express();
app.use(express.json());

function requireBigQuery(res) {
  if (!bigquery) {
    res.status(503).json({ error: 'BigQuery client is not configured on the server.' });
    return false;
  }
  return true;
}

function handleError(res, error) {
  if (error instanceof ValidationError) {
    res.status(400).json({ error: error.message });
    return;
  }
  console.error('Request failed:', error);
  res.status(500).json({ error: error?.message ?? 'Unexpected error' });
}

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    projectId: process.env.PROJECT_NAME ?? null,
    bigqueryReady: Boolean(bigquery),
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/reports', (_req, res) => {
  res.json({ reports: reportCatalog() });
});

app.post('/api/sites', async (req, res) => {
  if (!requireBigQuery(res)) {
    return;
  }
  try {
    const { query } = buildSitesQuery(req.body ?? {});
    const [rows] = await bigquery.query({ query });
    res.json({ sites: rows });
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/reports/:reportId', async (req, res) => {
  if (!requireBigQuery(res)) {
    return;
  }
  try {
    const { report, query, params, types } = buildReportQuery(req.params.reportId, req.body ?? {});
    const [rows, , metadata] = await bigquery.query({ query, params, types });
    res.json({
      reportId: report.id,
      columns: report.columns,
      rows,
      bytesProcessed: Number(metadata?.totalBytesProcessed ?? 0),
    });
  } catch (error) {
    handleError(res, error);
  }
});

app.use(express.static(DIST_DIR));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`ga4-gsc-unified listening on port ${PORT}`);
});
