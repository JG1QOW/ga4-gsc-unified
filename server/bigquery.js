import { BigQuery } from '@google-cloud/bigquery';

const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const DATASET_PATTERN = /^[A-Za-z0-9_]{1,1024}$/;

function decodeCredentials() {
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

export function createBigQueryClient() {
  const projectId = process.env.PROJECT_NAME;
  const credentials = decodeCredentials();
  if (!projectId) {
    console.warn('PROJECT_NAME is not set; BigQuery client is unavailable.');
    return null;
  }
  if (!credentials) {
    console.warn('GCP_SA_KEY_BASE64 is not set; BigQuery client is unavailable.');
    return null;
  }
  return new BigQuery({ projectId, credentials });
}

export class ValidationError extends Error {}

export function assertProjectId(value) {
  if (typeof value !== 'string' || !PROJECT_ID_PATTERN.test(value)) {
    throw new ValidationError(`Invalid GCP project id: ${String(value)}`);
  }
  return value;
}

export function assertDatasetId(value, label) {
  if (typeof value !== 'string' || !DATASET_PATTERN.test(value)) {
    throw new ValidationError(`Invalid ${label}: ${String(value)}`);
  }
  return value;
}

export function assertDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError(`Invalid ${label}: ${String(value)}`);
  }
  return value;
}
