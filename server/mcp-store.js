import crypto from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import { assertDatasetId, assertProjectId, ValidationError } from './bigquery.js';

const COLLECTION = process.env.MCP_COLLECTION ?? 'ga4GscMcpInstances';
const AUTH_MODES = ['token', 'none'];

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

function createFirestore() {
  const projectId = process.env.PROJECT_NAME;
  const credentials = decodeCredentials();
  if (!projectId || !credentials) {
    return null;
  }
  return new Firestore({ projectId, credentials });
}

function memoryBackend() {
  const documents = new Map();
  return {
    kind: 'memory',
    async list() {
      return [...documents.values()];
    },
    async get(id) {
      return documents.get(id) ?? null;
    },
    async set(id, document) {
      documents.set(id, document);
    },
    async patch(id, changes) {
      const current = documents.get(id);
      if (current) {
        documents.set(id, { ...current, ...changes });
      }
    },
    async remove(id) {
      documents.delete(id);
    },
  };
}

function firestoreBackend(firestore) {
  const collection = firestore.collection(COLLECTION);
  return {
    kind: 'firestore',
    async list() {
      const snapshot = await collection.get();
      return snapshot.docs.map((doc) => doc.data());
    },
    async get(id) {
      const doc = await collection.doc(id).get();
      return doc.exists ? doc.data() : null;
    },
    async set(id, document) {
      await collection.doc(id).set(document);
    },
    async patch(id, changes) {
      await collection.doc(id).set(changes, { merge: true });
    },
    async remove(id) {
      await collection.doc(id).delete();
    },
  };
}

function tokenSalt() {
  return process.env.MCP_TOKEN_SALT ?? '';
}

function hashToken(token) {
  return crypto.createHash('sha256').update(`${tokenSalt()}:${token}`).digest('hex');
}

function issueToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

function assertAuthMode(value) {
  if (!AUTH_MODES.includes(value)) {
    throw new ValidationError(`Invalid auth mode: ${String(value)}`);
  }
  return value;
}

function assertName(value) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 120) {
    throw new ValidationError('Invalid MCP instance name.');
  }
  return value.trim();
}

export function publicInstance(document) {
  return {
    id: document.id,
    name: document.name,
    project: document.project,
    ga4Dataset: document.ga4Dataset,
    gscDataset: document.gscDataset,
    auth: document.auth,
    createdAt: document.createdAt,
    revokedAt: document.revokedAt,
    lastUsedAt: document.lastUsedAt,
  };
}

export function createMcpStore() {
  const firestore = createFirestore();
  if (!firestore) {
    console.warn('Firestore is not configured; MCP instances are kept in memory only.');
  }
  const backend = firestore ? firestoreBackend(firestore) : memoryBackend();

  return {
    kind: backend.kind,

    async list() {
      const documents = await backend.list();
      return documents
        .map(publicInstance)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    },

    async create(input) {
      const auth = assertAuthMode(input.auth);
      const document = {
        id: crypto.randomBytes(16).toString('base64url'),
        name: assertName(input.name),
        project: assertProjectId(input.project),
        ga4Dataset: assertDatasetId(input.ga4Dataset, 'GA4 dataset'),
        gscDataset: assertDatasetId(input.gscDataset, 'GSC dataset'),
        auth,
        tokenHash: null,
        createdAt: new Date().toISOString(),
        revokedAt: null,
        lastUsedAt: null,
      };
      let token = null;
      if (auth === 'token') {
        const issued = issueToken();
        token = issued.token;
        document.tokenHash = issued.tokenHash;
      }
      await backend.set(document.id, document);
      return { instance: publicInstance(document), token };
    },

    async reissueToken(id) {
      const document = await backend.get(id);
      if (!document) {
        return null;
      }
      const issued = issueToken();
      await backend.patch(id, { auth: 'token', tokenHash: issued.tokenHash, revokedAt: null });
      return { instance: publicInstance({ ...document, auth: 'token', revokedAt: null }), token: issued.token };
    },

    async setAuthMode(id, auth) {
      assertAuthMode(auth);
      const document = await backend.get(id);
      if (!document) {
        return null;
      }
      if (auth === 'token') {
        const issued = issueToken();
        await backend.patch(id, { auth, tokenHash: issued.tokenHash });
        return { instance: publicInstance({ ...document, auth }), token: issued.token };
      }
      await backend.patch(id, { auth, tokenHash: null });
      return { instance: publicInstance({ ...document, auth, tokenHash: null }), token: null };
    },

    async revoke(id) {
      const document = await backend.get(id);
      if (!document) {
        return null;
      }
      const revokedAt = new Date().toISOString();
      await backend.patch(id, { revokedAt });
      return publicInstance({ ...document, revokedAt });
    },

    async remove(id) {
      const document = await backend.get(id);
      if (!document) {
        return null;
      }
      await backend.remove(id);
      return publicInstance(document);
    },

    async authorize(id, presentedToken) {
      const document = await backend.get(id);
      if (!document || document.revokedAt) {
        return { status: 'not-found' };
      }
      if (document.auth === 'token') {
        if (typeof presentedToken !== 'string' || presentedToken.length === 0) {
          return { status: 'unauthorized' };
        }
        const expected = Buffer.from(document.tokenHash ?? '', 'utf8');
        const actual = Buffer.from(hashToken(presentedToken), 'utf8');
        if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
          return { status: 'unauthorized' };
        }
      }
      return { status: 'ok', instance: document };
    },

    async touch(id) {
      await backend.patch(id, { lastUsedAt: new Date().toISOString() });
    },
  };
}
