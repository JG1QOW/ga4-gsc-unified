import { ValidationError } from './bigquery.js';
import { buildReportQuery, buildSitesQuery, reportCatalog } from './reports.js';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'ga4-gsc-unified';
const MAX_BYTES_BILLED = process.env.MCP_MAX_BYTES_BILLED ?? String(50 * 1024 ** 3);

const TOOL_DEFINITIONS = [
  {
    name: 'list_reports',
    description:
      'List the available GA4 / Google Search Console report types with their columns and default thresholds.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_sites',
    description: 'List the Search Console properties (site_url) contained in the configured GSC dataset.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'describe_tables',
    description: 'List tables and their schemas in the configured GA4 or GSC dataset.',
    inputSchema: {
      type: 'object',
      required: ['dataset'],
      properties: { dataset: { type: 'string', enum: ['ga4', 'gsc'] } },
    },
  },
  {
    name: 'run_report',
    description:
      'Run a report from list_reports over a date range and return its rows. Dates are inclusive and formatted as YYYY-MM-DD.',
    inputSchema: {
      type: 'object',
      required: ['reportId', 'startDate', 'endDate'],
      properties: {
        reportId: { type: 'string' },
        startDate: { type: 'string' },
        endDate: { type: 'string' },
        site: { type: 'string', description: 'Search Console property from list_sites. Omit for all properties.' },
        threshold: { type: 'number' },
        limit: { type: 'number', description: 'Maximum rows (1-500, default 100).' },
      },
    },
  },
];

function numberOrUndefined(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

async function describeTables(bigquery, instance, args) {
  const dataset = args.dataset === 'ga4' ? instance.ga4Dataset : args.dataset === 'gsc' ? instance.gscDataset : null;
  if (!dataset) {
    throw new ValidationError("dataset must be either 'ga4' or 'gsc'.");
  }
  const [tables] = await bigquery.dataset(dataset, { projectId: instance.project }).getTables();
  const described = await Promise.all(
    tables.map(async (table) => {
      const [metadata] = await table.getMetadata();
      return {
        table: table.id,
        rows: Number(metadata.numRows ?? 0),
        fields: (metadata.schema?.fields ?? []).map((field) => ({ name: field.name, type: field.type })),
      };
    }),
  );
  return { project: instance.project, dataset, tables: described };
}

async function runReport(bigquery, instance, args) {
  const { report, query, params, types } = buildReportQuery(args.reportId, {
    project: instance.project,
    ga4Dataset: instance.ga4Dataset,
    gscDataset: instance.gscDataset,
    startDate: args.startDate,
    endDate: args.endDate,
    site: args.site,
    threshold: numberOrUndefined(args.threshold),
    limit: numberOrUndefined(args.limit),
  });
  const [rows, , metadata] = await bigquery.query({
    query,
    params,
    types,
    maximumBytesBilled: MAX_BYTES_BILLED,
  });
  return {
    reportId: report.id,
    name: report.name,
    columns: report.columns,
    rows,
    bytesProcessed: Number(metadata?.totalBytesProcessed ?? 0),
  };
}

async function listSites(bigquery, instance) {
  const { query } = buildSitesQuery({ project: instance.project, gscDataset: instance.gscDataset });
  const [rows] = await bigquery.query({ query, maximumBytesBilled: MAX_BYTES_BILLED });
  return { sites: rows };
}

async function callTool(bigquery, instance, name, args) {
  switch (name) {
    case 'list_reports':
      return { reports: reportCatalog() };
    case 'list_sites':
      return listSites(bigquery, instance);
    case 'describe_tables':
      return describeTables(bigquery, instance, args);
    case 'run_report':
      return runReport(bigquery, instance, args);
    default:
      return null;
  }
}

export function mcpInstanceInfo(instanceId, instance) {
  return {
    server: SERVER_NAME,
    instance: { name: instance.name, createdAt: instance.createdAt },
    transport: 'http-jsonrpc',
    protocolVersion: PROTOCOL_VERSION,
    endpoint: `/mcp/${instanceId}`,
    auth: instance.auth === 'token' ? 'bearer token or ?token= query parameter' : 'none',
    project: instance.project,
    datasets: { ga4: instance.ga4Dataset, gsc: instance.gscDataset },
    tools: TOOL_DEFINITIONS.map((tool) => tool.name),
  };
}

export async function handleMcpRequest({ bigquery, instance, payload }) {
  const jsonrpc = payload?.jsonrpc ?? '2.0';
  const id = payload?.id ?? null;
  const method = payload?.method;
  const params = payload?.params ?? {};

  const ok = (result) => ({ jsonrpc, id, result });
  const fail = (code, message) => ({ jsonrpc, id, error: { code, message } });

  if (method === 'initialize') {
    return ok({
      protocolVersion: PROTOCOL_VERSION,
      serverInfo: { name: SERVER_NAME, version: '1.0.0' },
      capabilities: { tools: {} },
    });
  }

  if (method === 'notifications/initialized') {
    return null;
  }

  if (method === 'ping') {
    return ok({});
  }

  if (method === 'tools/list') {
    return ok({ tools: TOOL_DEFINITIONS });
  }

  if (method === 'tools/call') {
    if (!bigquery) {
      return fail(-32000, 'BigQuery client is not configured on the server.');
    }
    try {
      const result = await callTool(bigquery, instance, params.name, params.arguments ?? {});
      if (!result) {
        return fail(-32602, `Unknown tool: ${String(params.name)}`);
      }
      return ok({ content: [{ type: 'text', text: JSON.stringify(result) }] });
    } catch (error) {
      if (error instanceof ValidationError) {
        return fail(-32602, error.message);
      }
      console.error('MCP tool call failed:', error);
      return fail(-32000, 'Tool execution failed.');
    }
  }

  return fail(-32601, `Method not found: ${String(method)}`);
}
