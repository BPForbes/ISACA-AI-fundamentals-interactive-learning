import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { sha256Hex, type Env } from '../src/index';
import { createFakeD1 } from './fakeD1';

const TOKEN = `tok-${Math.random().toString(36).slice(2)}`;
// A fake provider key, generated per run so no key-shaped literal is committed.
const API_KEY = `gsk_${crypto.getRandomValues(new Uint8Array(16)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '')}`;
const ORIGIN = 'https://bpforbes.github.io';
const kek = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

let env: Env;
let fake: ReturnType<typeof createFakeD1>;

beforeEach(async () => {
  fake = createFakeD1(new URL('../migrations', import.meta.url).pathname);
  env = {
    DB: fake.d1 as unknown as D1Database,
    SYNC_TOKEN_SHA256: await sha256Hex(TOKEN),
    ALLOWED_ORIGINS: ORIGIN,
    KEY_ENCRYPTION_KEY: kek(),
  };
});

afterEach(() => vi.unstubAllGlobals());

const call = (method: string, path: string, body?: unknown, token: string | null = TOKEN) => {
  const headers = new Headers({ Origin: ORIGIN, 'Content-Type': 'application/json' });
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
};

const upload = () => call('PUT', '/api/vault/groq', { apiKey: API_KEY });

describe('key vault', () => {
  it('stores only ciphertext and never returns the key', async () => {
    const put = await upload();
    expect(put.status).toBe(200);
    expect(await put.text()).not.toContain(API_KEY);
    const row = fake.db.prepare('SELECT * FROM provider_keys').get() as Record<string, string>;
    expect(JSON.stringify(row)).not.toContain(API_KEY);
    expect(row.provider).toBe('groq');
    const list = await call('GET', '/api/vault');
    const text = await list.text();
    expect(JSON.parse(text).providers).toEqual([expect.objectContaining({ provider: 'groq' })]);
    expect(text).not.toContain(API_KEY);
  });

  it('requires the sync token and a configured encryption key', async () => {
    expect((await call('PUT', '/api/vault/groq', { apiKey: API_KEY }, null)).status).toBe(401);
    env.KEY_ENCRYPTION_KEY = undefined;
    expect((await upload()).status).toBe(503);
    expect((fake.db.prepare('SELECT COUNT(*) AS n FROM provider_keys').get() as { n: number }).n).toBe(0);
  });

  it('accepts only known providers and well-formed keys', async () => {
    expect((await call('PUT', '/api/vault/evil', { apiKey: API_KEY })).status).toBe(400);
    expect((await call('PUT', '/api/vault/groq', { apiKey: 'short' })).status).toBe(400);
    expect((await call('PUT', '/api/vault/groq', { apiKey: `${API_KEY}\nX-Injected: 1` })).status).toBe(400);
    expect((await call('PUT', '/api/vault/constructor', { apiKey: API_KEY })).status).toBe(400);
  });

  it('calls the provider with the decrypted key and returns only the completion', async () => {
    await upload();
    const providerFetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })));
    vi.stubGlobal('fetch', providerFetch);
    const res = await call('POST', '/api/vault/groq/chat', { model: 'openai/gpt-oss-120b', system: 's', user: 'u', maxTokens: 50 });
    expect(await res.json()).toEqual({ response: '{"ok":true}' });
    const [url, init] = providerFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${API_KEY}`);
  });

  it('does not relay provider error bodies, which can quote the key', async () => {
    await upload();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`Invalid API key: ${API_KEY}`, { status: 401 })));
    const res = await call('POST', '/api/vault/groq/chat', { model: 'm', system: 's', user: 'u' });
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain(API_KEY);
  });

  it('refuses a ciphertext moved to another provider, or a changed encryption key', async () => {
    await upload();
    fake.db.exec("INSERT INTO provider_keys (provider, iv, ciphertext, updated_at) SELECT 'gemini', iv, ciphertext, updated_at FROM provider_keys WHERE provider = 'groq'");
    vi.stubGlobal('fetch', vi.fn());
    expect((await call('POST', '/api/vault/gemini/chat', { model: 'm', system: 's', user: 'u' })).status).toBe(500);
    env.KEY_ENCRYPTION_KEY = kek();
    expect((await call('POST', '/api/vault/groq/chat', { model: 'm', system: 's', user: 'u' })).status).toBe(500);
  });

  it('lists models through the stored key and deletes the key on request', async () => {
    await upload();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'openai/gpt-oss-120b' }] }))));
    expect(await (await call('GET', '/api/vault/groq/models')).json()).toEqual({ models: ['openai/gpt-oss-120b'] });
    expect((await call('DELETE', '/api/vault/groq')).status).toBe(200);
    expect((await call('POST', '/api/vault/groq/chat', { model: 'm', system: 's', user: 'u' })).status).toBe(404);
  });

  it('rejects malformed model names', async () => {
    await upload();
    expect((await call('POST', '/api/vault/groq/chat', { model: '../../x?y', system: 's', user: 'u' })).status).toBe(400);
  });
});
