import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cache = new Set<string>();
const created: string[] = [];
vi.mock('@mlc-ai/web-llm', () => ({
  CreateMLCEngine: vi.fn(async (id: string) => {
    created.push(id);
    cache.add(id);
    return { unload: vi.fn(async () => undefined) };
  }),
  hasModelInCache: vi.fn(async (id: string) => cache.has(id)),
  deleteModelAllInfoInCache: vi.fn(async (id: string) => {
    cache.delete(id);
  }),
}));

const store = new Map<string, string>();
const persist = vi.fn(async () => true);
const cacheNames = new Set<string>();
const dbNames = new Set<string>();
let used = 0;

beforeEach(() => {
  vi.resetModules();
  cache.clear();
  created.length = 0;
  store.clear();
  persist.mockClear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  });
  vi.stubGlobal('navigator', { gpu: {}, storage: { persist, estimate: async () => ({ usage: used }) } });
  cacheNames.clear();
  dbNames.clear();
  vi.stubGlobal('caches', {
    keys: async () => [...cacheNames],
    delete: async (n: string) => {
      used -= 1e9;
      return cacheNames.delete(n);
    },
  });
  vi.stubGlobal('indexedDB', {
    databases: async () => [...dbNames].map((name) => ({ name })),
    deleteDatabase: (n: string) => dbNames.delete(n),
  });
});

afterEach(() => vi.unstubAllGlobals());

const MODEL = 'Llama-3.2-3B-Instruct-q4f16_1-MLC';

describe('cached in-browser model', () => {
  it('remembers a loaded model and asks for persistent storage', async () => {
    const m = await import('../webllm');
    const changed = vi.fn();
    m.onBrowserModelChange(changed);
    expect(await m.preloadBrowserModel(MODEL)).toBe(true);
    expect(m.isBrowserModelReady(MODEL)).toBe(true);
    expect(m.rememberedBrowserModel()).toBe(MODEL);
    expect(persist).toHaveBeenCalled();
    expect(changed).toHaveBeenCalled();
  });

  it('reloads a remembered model from the cache on the next visit', async () => {
    cache.add(MODEL);
    store.set('isaca-quest-browser-model-v1', MODEL);
    const m = await import('../webllm');
    expect(await m.restoreCachedBrowserModel()).toBe(MODEL);
    expect(m.isBrowserModelReady(MODEL)).toBe(true);
  });

  it('never downloads on startup: nothing remembered or nothing cached means no load', async () => {
    const m = await import('../webllm');
    expect(await m.restoreCachedBrowserModel()).toBeNull();
    store.set('isaca-quest-browser-model-v1', MODEL);
    expect(await m.restoreCachedBrowserModel()).toBeNull();
    expect(created).toEqual([]);
  });

  it('does nothing without WebGPU', async () => {
    cache.add(MODEL);
    store.set('isaca-quest-browser-model-v1', MODEL);
    vi.stubGlobal('navigator', { storage: { persist } });
    const m = await import('../webllm');
    expect(await m.restoreCachedBrowserModel()).toBeNull();
  });

  it('removes the model from the device and stops auto-loading it', async () => {
    const m = await import('../webllm');
    await m.preloadBrowserModel(MODEL);
    await m.removeCachedBrowserModel(MODEL);
    expect(m.isBrowserModelReady(MODEL)).toBe(false);
    expect(m.rememberedBrowserModel()).toBeNull();
    expect(await m.isModelCached(MODEL)).toBe(false);
  });
});

describe('uninstalling the local AI', () => {
  it('removes every model and WebLLM store, and nothing of the app', async () => {
    const m = await import('../webllm');
    await m.preloadBrowserModel(MODEL);
    cache.add('Qwen2.5-7B-Instruct-q4f16_1-MLC');
    ['webllm/model', 'webllm/config', 'webllm/wasm', 'app-other-cache'].forEach((n) => cacheNames.add(n));
    ['tvmjs-opfs-store', 'isaca-quest-db'].forEach((n) => dbNames.add(n));
    store.set('isaca-quest-session-v1', '{"progress":{}}');
    used = 6e9;
    const changed = vi.fn();
    m.onBrowserModelChange(changed);

    const result = await m.uninstallLocalAI();

    expect(result.removedModels.sort()).toEqual([MODEL, 'Qwen2.5-7B-Instruct-q4f16_1-MLC'].sort());
    expect(result.freedBytes).toBe(3e9);
    expect(cache.size).toBe(0);
    expect([...cacheNames]).toEqual(['app-other-cache']);
    expect([...dbNames]).toEqual(['isaca-quest-db']);
    expect(m.isBrowserModelReady(MODEL)).toBe(false);
    expect(m.rememberedBrowserModel()).toBeNull();
    expect(store.get('isaca-quest-session-v1')).toBe('{"progress":{}}');
    expect(changed).toHaveBeenCalled();
    // Nothing comes back on the next visit.
    expect(await m.restoreCachedBrowserModel()).toBeNull();
  });

  it('is harmless when nothing is installed', async () => {
    const m = await import('../webllm');
    expect((await m.uninstallLocalAI()).removedModels).toEqual([]);
  });
});
