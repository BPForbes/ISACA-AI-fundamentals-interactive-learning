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
  vi.stubGlobal('navigator', { gpu: {}, storage: { persist } });
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
