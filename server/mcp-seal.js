import crypto from 'node:crypto';
import { assertDatasetId, assertProjectId, ValidationError } from './bigquery.js';

const AUTH_MODES = ['token', 'none'];
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_INFO = 'ga4-gsc-unified:mcp-endpoint:v1';

export function sealKeyConfigured() {
  return Boolean(process.env.MCP_SEAL_KEY);
}

function sealKey() {
  const secret = process.env.MCP_SEAL_KEY;
  if (!secret) {
    throw new ValidationError('MCP_SEAL_KEY is not configured on the server.');
  }
  return crypto.hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), Buffer.from(KEY_INFO, 'utf8'), 32);
}

function assertAuthMode(value) {
  if (!AUTH_MODES.includes(value)) {
    throw new ValidationError(`Invalid auth mode: ${String(value)}`);
  }
  return value;
}

function assertName(value) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 120) {
    throw new ValidationError('Invalid MCP endpoint name.');
  }
  return value.trim();
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('base64url');
}

function seal(payload) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(sealKey()), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64url');
}

export function unseal(sealed) {
  if (typeof sealed !== 'string' || sealed.length === 0) {
    return null;
  }
  const raw = Buffer.from(sealed, 'base64url');
  if (raw.length <= IV_BYTES + TAG_BYTES) {
    return null;
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(sealKey()), raw.subarray(0, IV_BYTES));
  decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
  let plaintext;
  try {
    plaintext = Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(plaintext);
  } catch (error) {
    console.error('Failed to parse sealed MCP payload:', error);
    return null;
  }
}

export function createMcpEndpoint(input) {
  const auth = assertAuthMode(input.auth);
  const payload = {
    v: 1,
    name: assertName(input.name),
    project: assertProjectId(input.project),
    ga4Dataset: assertDatasetId(input.ga4Dataset, 'GA4 dataset'),
    gscDataset: assertDatasetId(input.gscDataset, 'GSC dataset'),
    auth,
    createdAt: new Date().toISOString(),
  };
  let token = null;
  if (auth === 'token') {
    token = crypto.randomBytes(32).toString('base64url');
    payload.tokenHash = hashToken(token);
  }
  return { id: seal(payload), instance: payload, token };
}

export function authorizeMcpEndpoint(sealed, presentedToken) {
  const instance = unseal(sealed);
  if (!instance || instance.v !== 1) {
    return { status: 'not-found' };
  }
  if (instance.auth === 'token') {
    if (typeof presentedToken !== 'string' || presentedToken.length === 0) {
      return { status: 'unauthorized' };
    }
    const expected = Buffer.from(instance.tokenHash ?? '', 'utf8');
    const actual = Buffer.from(hashToken(presentedToken), 'utf8');
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      return { status: 'unauthorized' };
    }
  }
  return { status: 'ok', instance };
}
