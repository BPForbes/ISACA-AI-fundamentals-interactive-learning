// Encrypted vault for the learner's hosted-model API keys.
//
// A key is uploaded once, encrypted with AES-256-GCM under KEY_ENCRYPTION_KEY
// (a Worker secret that never leaves Cloudflare's secret store), and stored in
// D1 as ciphertext only. No route ever returns it: the Worker decrypts it per
// request to call the provider on the learner's behalf, and the browser keeps
// no copy. The provider list is fixed here so the Worker can only ever send a
// key to that provider's own API (no caller-chosen URLs).

import { HttpError, num, obj, str } from './http';

export type VaultEnv = { DB: D1Database; KEY_ENCRYPTION_KEY?: string };

export const VAULT_PROVIDERS: Record<string, string> = {
  groq: 'https://api.groq.com/openai/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  openrouter: 'https://openrouter.ai/api/v1',
};

const API_KEY = /^[\x21-\x7e]{8,512}$/;
const MODEL = /^[A-Za-z0-9._:/-]{1,120}$/;
const MAX_PROMPT_CHARS = 20_000;
const PROVIDER_TIMEOUT_MS = 60_000;

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

// Binds each ciphertext to its provider row, so a stored blob cannot be replayed under another provider.
const aad = (provider: string) => new TextEncoder().encode(`isaca-quest:provider-key:v1:${provider}`);

const encryptionKey = async (env: VaultEnv): Promise<CryptoKey> => {
  let raw: Uint8Array;
  try {
    raw = unb64((env.KEY_ENCRYPTION_KEY ?? '').trim());
  } catch {
    raw = new Uint8Array();
  }
  if (raw.length !== 32) throw new HttpError(503, 'The key vault is not configured on the Worker (KEY_ENCRYPTION_KEY).');
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
};

export const encryptKey = async (env: VaultEnv, provider: string, apiKey: string) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(provider) },
    await encryptionKey(env),
    new TextEncoder().encode(apiKey),
  );
  return { iv: b64(iv), ciphertext: b64(new Uint8Array(sealed)) };
};

const decryptKey = async (env: VaultEnv, provider: string): Promise<string> => {
  const row = await env.DB.prepare('SELECT iv, ciphertext FROM provider_keys WHERE provider = ?')
    .bind(provider).first<{ iv: string; ciphertext: string }>();
  if (!row) throw new HttpError(404, 'No key is stored for this provider.');
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(row.iv), additionalData: aad(provider) },
      await encryptionKey(env),
      unb64(row.ciphertext),
    );
    return new TextDecoder().decode(plain);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    // Wrong encryption key or tampered row; never say more than that.
    throw new HttpError(500, 'The stored key could not be decrypted; upload it again.');
  }
};

const providerOf = (name: string): string => {
  if (!Object.hasOwn(VAULT_PROVIDERS, name)) throw new HttpError(400, 'Unknown provider.');
  return name;
};

// Provider error bodies can quote part of the key, so only the status is passed on.
const providerFailure = (status: number): HttpError => {
  if (status === 401 || status === 403) return new HttpError(502, 'The provider rejected the stored key.');
  if (status === 429) return new HttpError(429, "The provider's free-tier limit was reached.");
  if (status === 404) return new HttpError(404, 'The provider does not know that model.');
  return new HttpError(502, `The provider answered ${status}.`);
};

export const listStored = async (env: VaultEnv) => {
  const rows = await env.DB.prepare('SELECT provider, updated_at FROM provider_keys ORDER BY provider').all<{ provider: string; updated_at: string }>();
  return { providers: rows.results.map((r) => ({ provider: r.provider, updatedAt: r.updated_at })) };
};

export const storeKey = async (env: VaultEnv, providerName: string, body: unknown, now: string) => {
  const provider = providerOf(providerName);
  const apiKey = str(obj(body, 'request').apiKey, 'apiKey', 512, API_KEY);
  const sealed = await encryptKey(env, provider, apiKey);
  await env.DB.prepare(
    `INSERT INTO provider_keys (provider, iv, ciphertext, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET iv = excluded.iv, ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`,
  ).bind(provider, sealed.iv, sealed.ciphertext, now).run();
  return { stored: true, provider, updatedAt: now };
};

export const deleteKey = async (env: VaultEnv, providerName: string) => {
  const provider = providerOf(providerName);
  await env.DB.prepare('DELETE FROM provider_keys WHERE provider = ?').bind(provider).run();
  return { deleted: true, provider };
};

const callProvider = (base: string, path: string, apiKey: string, init: RequestInit = {}) =>
  fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });

export const chatWithStoredKey = async (env: VaultEnv, providerName: string, body: unknown) => {
  const provider = providerOf(providerName);
  const b = obj(body, 'request');
  const request = {
    model: str(b.model, 'model', 120, MODEL),
    messages: [
      { role: 'system', content: str(b.system, 'system', MAX_PROMPT_CHARS) },
      { role: 'user', content: str(b.user, 'user', MAX_PROMPT_CHARS) },
    ],
    temperature: 0.8,
    max_tokens: Math.round(num(b.maxTokens ?? 900, 'maxTokens', 1, 1500)),
  };
  const apiKey = await decryptKey(env, provider);
  const base = VAULT_PROVIDERS[provider];
  // JSON mode first; a model that rejects the option is retried once without it.
  let response = await callProvider(base, '/chat/completions', apiKey, {
    method: 'POST',
    body: JSON.stringify({ ...request, response_format: { type: 'json_object' } }),
  });
  if (response.status === 400) {
    response = await callProvider(base, '/chat/completions', apiKey, { method: 'POST', body: JSON.stringify(request) });
  }
  if (!response.ok) throw providerFailure(response.status);
  const data = (await response.json()) as { choices?: { message?: { content?: string | null } }[] };
  return { response: data.choices?.[0]?.message?.content ?? null };
};

export const modelsWithStoredKey = async (env: VaultEnv, providerName: string) => {
  const provider = providerOf(providerName);
  const apiKey = await decryptKey(env, provider);
  const response = await callProvider(VAULT_PROVIDERS[provider], '/models', apiKey);
  if (!response.ok) throw providerFailure(response.status);
  const data = (await response.json()) as { data?: { id?: unknown }[] };
  return { models: (data.data ?? []).map((m) => (typeof m.id === 'string' ? m.id : '')).filter(Boolean).slice(0, 500) };
};
