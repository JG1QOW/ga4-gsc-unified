import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createBigQueryClient, ValidationError } from './bigquery.js';
import { buildReportQuery, buildSitesQuery, reportCatalog } from './reports.js';
import { handleMcpRequest, mcpInstanceInfo } from './mcp.js';
import { createMcpStore } from './mcp-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT) || 8080;

const bigquery = createBigQueryClient();
const mcpStore = createMcpStore();

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
    mcpStore: mcpStore.kind,
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

function presentedToken(req) {
  const header = req.get('authorization') ?? '';
  const bearer = header.match(/^Bearer\s+(.+)$/i);
  if (bearer) {
    return bearer[1].trim();
  }
  return typeof req.query.token === 'string' ? req.query.token : null;
}

async function resolveMcpInstance(req, res) {
  const outcome = await mcpStore.authorize(req.params.instanceId, presentedToken(req));
  if (outcome.status === 'not-found') {
    res.status(404).json({ error: 'MCP instance not found.' });
    return null;
  }
  if (outcome.status === 'unauthorized') {
    res.status(401).json({ error: 'Invalid or missing token.' });
    return null;
  }
  return outcome.instance;
}

app.get('/api/mcp/instances', async (_req, res) => {
  try {
    res.json({ instances: await mcpStore.list(), store: mcpStore.kind });
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/mcp/instances', async (req, res) => {
  try {
    const { instance, token } = await mcpStore.create(req.body ?? {});
    res.status(201).json({ instance, token });
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/mcp/instances/:instanceId/auth', async (req, res) => {
  try {
    const result = await mcpStore.setAuthMode(req.params.instanceId, (req.body ?? {}).auth);
    if (!result) {
      res.status(404).json({ error: 'MCP instance not found.' });
      return;
    }
    res.json(result);
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/mcp/instances/:instanceId/token', async (req, res) => {
  try {
    const result = await mcpStore.reissueToken(req.params.instanceId);
    if (!result) {
      res.status(404).json({ error: 'MCP instance not found.' });
      return;
    }
    res.json(result);
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/mcp/instances/:instanceId/revoke', async (req, res) => {
  try {
    const instance = await mcpStore.revoke(req.params.instanceId);
    if (!instance) {
      res.status(404).json({ error: 'MCP instance not found.' });
      return;
    }
    res.json({ instance });
  } catch (error) {
    handleError(res, error);
  }
});

app.delete('/api/mcp/instances/:instanceId', async (req, res) => {
  try {
    const instance = await mcpStore.remove(req.params.instanceId);
    if (!instance) {
      res.status(404).json({ error: 'MCP instance not found.' });
      return;
    }
    res.json({ instance });
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/mcp/:instanceId', async (req, res) => {
  try {
    const instance = await resolveMcpInstance(req, res);
    if (instance) {
      res.json(mcpInstanceInfo(instance));
    }
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/mcp/:instanceId', async (req, res) => {
  try {
    const instance = await resolveMcpInstance(req, res);
    if (!instance) {
      return;
    }
    const response = await handleMcpRequest({ bigquery, instance, payload: req.body ?? {} });
    await mcpStore.touch(instance.id);
    if (!response) {
      res.status(204).end();
      return;
    }
    res.json(response);
  } catch (error) {
    handleError(res, error);
  }
});

app.use(express.static(DIST_DIR));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/mcp/')) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`ga4-gsc-unified listening on port ${PORT}`);
});
