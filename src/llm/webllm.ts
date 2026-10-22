// In-browser model through WebLLM, kept lazy and singleton-scoped like the QPU
// lab so the multi-gigabyte download only starts when the learner asks for it.
//
// Caching: WebLLM keeps the downloaded weights in the browser's Cache Storage.
// This module remembers which model the learner chose, asks the browser to keep
// that storage persistent, and on later visits reloads the model from the cache
// automatically, so the download happens once per device.
import type { MLCEngine } from '@mlc-ai/web-llm';
import { BROWSER_MODEL_OPTIONS } from './config';

let enginePromise: Promise<MLCEngine> | null = null;
let loadedModelId: string | null = null;
let readyModelId: string | null = null;

const REMEMBER_KEY = 'isaca-quest-browser-model-v1';
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Subscribes to "a browser model became ready or was removed"; returns the unsubscribe. */
export const onBrowserModelChange = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const hasWebGpu = (): boolean => typeof navigator !== 'undefined' && 'gpu' in navigator;

export const isBrowserModelReady = (modelId: string): boolean => readyModelId === modelId;

export const rememberedBrowserModel = (): string | null => {
  try {
    return localStorage.getItem(REMEMBER_KEY);
  } catch {
    return null;
  }
};

const remember = (modelId: string | null) => {
  try {
    if (modelId) localStorage.setItem(REMEMBER_KEY, modelId);
    else localStorage.removeItem(REMEMBER_KEY);
  } catch {
    // Without storage the model is still cached; it just will not auto-load.
  }
};

/** Asks the browser not to evict the cached weights under storage pressure. */
const persistStorage = async (): Promise<boolean> => {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
};

export const isModelCached = async (modelId: string): Promise<boolean> => {
  try {
    const { hasModelInCache } = await import('@mlc-ai/web-llm');
    return await hasModelInCache(modelId);
  } catch {
    return false;
  }
};

const getEngine = (modelId: string, onProgress?: (text: string) => void): Promise<MLCEngine> => {
  if (enginePromise && loadedModelId !== modelId) {
    enginePromise = null;
    readyModelId = null;
  }
  if (!enginePromise) {
    loadedModelId = modelId;
    enginePromise = (async () => {
      const { CreateMLCEngine } = await import('@mlc-ai/web-llm');
      const engine = await CreateMLCEngine(modelId, {
        initProgressCallback: (p) => {
          const pct = typeof p.progress === 'number' ? ` (${Math.round(p.progress * 100)}%)` : '';
          onProgress?.(`${p.text ?? 'Loading browser model…'}${pct}`);
        },
      });
      readyModelId = modelId;
      notify();
      return engine;
    })().catch((error) => {
      enginePromise = null;
      loadedModelId = null;
      throw error;
    });
  }
  return enginePromise;
};

// The first load is an explicit learner action because the download is large.
export const preloadBrowserModel = async (modelId: string, onProgress?: (text: string) => void): Promise<boolean> => {
  if (!hasWebGpu()) return false;
  await getEngine(modelId, onProgress);
  remember(modelId);
  await persistStorage();
  return true;
};

/**
 * On page load: if the learner loaded a model before and its weights are still
 * cached, load it again from the cache (no download). Returns the model id
 * restored, or null when there was nothing cached to restore.
 */
export const restoreCachedBrowserModel = async (onProgress?: (text: string) => void): Promise<string | null> => {
  const modelId = rememberedBrowserModel();
  if (!modelId || !hasWebGpu() || !(await isModelCached(modelId))) return null;
  await getEngine(modelId, onProgress);
  return modelId;
};

/** Removes the model from this device's cache and stops auto-loading it. */
export const removeCachedBrowserModel = async (modelId: string): Promise<void> => {
  if (loadedModelId === modelId) {
    const engine = enginePromise;
    enginePromise = null;
    loadedModelId = null;
    readyModelId = null;
    await engine?.then((e) => e.unload()).catch(() => undefined);
  }
  if (rememberedBrowserModel() === modelId) remember(null);
  const { deleteModelAllInfoInCache } = await import('@mlc-ai/web-llm');
  await deleteModelAllInfoInCache(modelId);
  notify();
};

export const completeWithWebLlm = async (
  modelId: string,
  system: string,
  user: string,
  maxTokens: number,
): Promise<string | null> => {
  if (!hasWebGpu() || !isBrowserModelReady(modelId)) return null;
  const engine = await getEngine(modelId);
  const response = await engine.chat.completions.create({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.8,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
  });
  return response.choices[0]?.message?.content ?? null;
};

// Storage names WebLLM and its TVM runtime create (Cache Storage, IndexedDB). Only these are removed.
const LOCAL_AI_STORE = /^(webllm|tvmjs)/;

const storageUsed = async (): Promise<number | null> => {
  try {
    return (await navigator.storage?.estimate?.())?.usage ?? null;
  } catch {
    return null;
  }
};

/** Every offered model (plus the remembered one) whose weights are on this device. */
export const cachedModels = async (): Promise<string[]> => {
  const candidates = [...new Set([...BROWSER_MODEL_OPTIONS, rememberedBrowserModel()].filter((m): m is string => Boolean(m)))];
  const found: string[] = [];
  for (const m of candidates) if (await isModelCached(m)) found.push(m);
  return found;
};

export type UninstallResult = { removedModels: string[]; freedBytes: number | null };

/**
 * Uninstalls the local AI: unloads the model from memory, forgets the
 * auto-load choice, deletes every cached model, then removes any remaining
 * WebLLM storage (Cache Storage and IndexedDB). Study progress, settings and
 * API keys are untouched.
 */
export const uninstallLocalAI = async (): Promise<UninstallResult> => {
  const before = await storageUsed();
  const engine = enginePromise;
  enginePromise = null;
  loadedModelId = null;
  readyModelId = null;
  await engine?.then((e) => e.unload()).catch(() => undefined);
  remember(null);

  const removedModels = await cachedModels();
  try {
    const { deleteModelAllInfoInCache } = await import('@mlc-ai/web-llm');
    for (const m of removedModels) await deleteModelAllInfoInCache(m).catch(() => undefined);
  } catch {
    // The sweep below still removes the files.
  }
  try {
    if (typeof caches !== 'undefined') {
      for (const name of await caches.keys()) if (LOCAL_AI_STORE.test(name)) await caches.delete(name);
    }
  } catch {
    // Cache Storage unavailable; nothing to remove there.
  }
  try {
    const dbs = (await indexedDB?.databases?.()) ?? [];
    for (const db of dbs) if (db.name && LOCAL_AI_STORE.test(db.name)) indexedDB.deleteDatabase(db.name);
  } catch {
    // IndexedDB listing unsupported; WebLLM's default backend is Cache Storage.
  }

  notify();
  const after = await storageUsed();
  return { removedModels, freedBytes: before !== null && after !== null ? Math.max(0, before - after) : null };
};
