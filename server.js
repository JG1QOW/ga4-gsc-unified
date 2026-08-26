import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { BigQuery } from '@google-cloud/bigquery';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, 'dist');
const PORT = Number(process.env.PORT) || 8080;
const PROJECT_ID = process.env.PROJECT_NAME;

function loadCredentials() {
  const encoded = process.env.GCP_SA_KEY_BASE64;
  if (!encoded) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  } catch (error) {
    console.error('Failed to decode GCP_SA_KEY_BASE64:', error);
    return null;
  }
}

function createBigQueryClient() {
  const credentials = loadCredentials();
  if (!PROJECT_ID) {
    console.warn('PROJECT_NAME is not set; BigQuery client is unavailable.');
    return null;
  }
  if (!credentials) {
    console.warn('GCP_SA_KEY_BASE64 is not set; BigQuery client is unavailable.');
    return null;
  }
  return new BigQuery({ projectId: PROJECT_ID, credentials });
}

const bigquery = createBigQueryClient();

const app = express();
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    projectId: PROJECT_ID ?? null,
    bigqueryReady: Boolean(bigquery),
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/bigquery/ping', async (_req, res) => {
  if (!bigquery) {
    res.status(503).json({ error: 'BigQuery client is not configured.' });
    return;
  }
  try {
    const [rows] = await bigquery.query({ query: 'SELECT 1 AS ok', location: 'asia-northeast1' });
    res.json({ rows });
  } catch (error) {
    console.error('BigQuery ping failed:', error);
    res.status(500).json({ error: 'BigQuery query failed.' });
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
