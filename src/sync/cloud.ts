// Client for the Cloudflare Worker in worker/. The Worker URL and the learner's
// sync token live only in this browser's localStorage; the token is sent as a
// bearer header and never written into saved progress.

import type { TermProgress } from '../engine/progress';

export type CloudConfig = { url: string; token: string };

const STORAGE_KEY = 'isaca-quest-cloud-v1';

export const loadCloudConfig = (): CloudConfig => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const p = raw ? (JSON.parse(raw) as Partial<CloudConfig>) : {};
    return {
      // An empty saved URL falls back to the built-in one.
      url: typeof p.url === 'string' && p.url ? p.url : (import.meta.env.VITE_SYNC_URL ?? ''),
      token: typeof p.token === 'string' ? p.token : '',
    };
  } catch {
    return { url: import.meta.env.VITE_SYNC_URL ?? '', token: '' };
  }
};

export const saveCloudConfig = (c: CloudConfig) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ url: c.url.trim().replace(/\/+$/, ''), token: c.token.trim() }));
    // Ask the browser not to clear this site's storage on its own, so the settings stay.
    if (c.token) void navigator.storage?.persist?.()?.catch(() => {});
  } catch {
    // Without storage the config lasts for the tab only.
  }
};

export const isCloudConfigured = (c: CloudConfig): boolean => Boolean(c.url && c.token);

export type SessionSummary = {
  id: string;
  startedAt: string;
  endedAt: string;
  points: number;
  answered: number;
  correct: number;
  longestStreak: number;
  modesUsed: string[];
  expeditions: string[];
};

export type SceneEvent = {
  id: string;
  sessionId: string;
  at: string;
  chainId: string;
  anchor: string;
  mode: string;
  settingId: string;
  correct: boolean;
  risk: number;
  points: number;
  source: 'ai' | 'offline';
  note: string;
};

// The bit-packed mastery matrix (src/engine/matrix.ts), base64 in JSON.
export type MasterySnapshot = {
  packed: string;
  concepts: number;
  listVersion: number;
  // What triggered the save: the learner, a concept reaching mastery, or a struggle.
  reason: 'manual' | 'mastery' | 'struggle';
  updatedAt: string;
};

export type SavePayload = {
  saveId: string;
  session: SessionSummary;
  terms: TermProgress[];
  events: SceneEvent[];
  remediation: string[];
  // Older clients omit it.
  mastery?: MasterySnapshot;
};

export type RemoteProgress = {
  terms: TermProgress[];
  sessions: SessionSummary[];
  remediation: string[];
  // Recent answers, so a new device can train the progress model. Older Workers omit it.
  events?: SceneEvent[];
  mastery?: MasterySnapshot | null;
};

const request = async (c: CloudConfig, path: string, init: RequestInit = {}): Promise<Response> => {
  const response = await fetch(`${c.url}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.token}`, ...(init.headers ?? {}) },
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 200).replace(/[\u0000-\u001f]/g, ' ');
    throw new Error(`Cloud ${path} failed (${response.status}): ${body}`);
  }
  return response;
};

export const pushSave = async (c: CloudConfig, payload: SavePayload): Promise<{ status: 'saved' | 'already_saved' }> =>
  (await request(c, '/api/save', { method: 'POST', body: JSON.stringify(payload) })).json();

export const pullProgress = async (c: CloudConfig): Promise<RemoteProgress> =>
  (await request(c, '/api/progress')).json();

export const completeWithCloud = async (c: CloudConfig, system: string, user: string, maxTokens: number): Promise<string | null> => {
  const data = (await (await request(c, '/api/generate', {
    method: 'POST',
    body: JSON.stringify({ system, user, maxTokens }),
  })).json()) as { response?: string };
  return data.response ?? null;
};

// ---------- encrypted key vault (worker/src/vault.ts) ----------

export type StoredKey = { provider: string; updatedAt: string };

export const listVaultKeys = async (c: CloudConfig): Promise<StoredKey[]> =>
  ((await (await request(c, '/api/vault')).json()) as { providers: StoredKey[] }).providers;

/** Uploads a provider key; the Worker encrypts it and never sends it back. */
export const uploadVaultKey = async (c: CloudConfig, provider: string, apiKey: string): Promise<StoredKey> =>
  (await request(c, `/api/vault/${encodeURIComponent(provider)}`, { method: 'PUT', body: JSON.stringify({ apiKey }) })).json();

export const deleteVaultKey = async (c: CloudConfig, provider: string): Promise<void> => {
  await request(c, `/api/vault/${encodeURIComponent(provider)}`, { method: 'DELETE' });
};

export const vaultChat = async (c: CloudConfig, provider: string, body: { model: string; system: string; user: string; maxTokens: number }): Promise<string | null> =>
  ((await (await request(c, `/api/vault/${encodeURIComponent(provider)}/chat`, { method: 'POST', body: JSON.stringify(body) })).json()) as { response: string | null }).response;

export const vaultModels = async (c: CloudConfig, provider: string): Promise<string[]> =>
  ((await (await request(c, `/api/vault/${encodeURIComponent(provider)}/models`)).json()) as { models: string[] }).models;
