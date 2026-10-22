// Model backend preferences. Like the QPU lab, the browser model is the
// preferred AI path because it needs no server once cached; Ollama serves a
// local model, and "cloud" asks the Cloudflare Worker's Workers AI binding.
// "auto" uses whichever AI is ready and otherwise the offline generator.

export type LlmMode = 'auto' | 'browser' | 'ollama' | 'cloud' | 'offline';

export type LlmSettings = {
  mode: LlmMode;
  browserModel: string;
  ollamaUrl: string;
  ollamaModel: string;
};

const STORAGE_KEY = 'isaca-quest-llm-settings-v1';

export const BROWSER_MODEL_OPTIONS = [
  'Llama-3.2-3B-Instruct-q4f16_1-MLC',
  'Qwen2.5-3B-Instruct-q4f16_1-MLC',
  'Llama-3.2-1B-Instruct-q4f16_1-MLC',
] as const;

// Scenario writing needs more than intent parsing does, so the default is the 3B model.
export const DEFAULT_BROWSER_MODEL = import.meta.env.VITE_WEBLLM_MODEL ?? BROWSER_MODEL_OPTIONS[0];
const DEFAULT_OLLAMA_URL = import.meta.env.VITE_OLLAMA_URL ?? 'http://localhost:11434/api/generate';
const DEFAULT_OLLAMA_MODEL = import.meta.env.VITE_OLLAMA_MODEL ?? 'llama3.1:8b';

export const defaultLlmSettings = (): LlmSettings => ({
  mode: 'auto',
  browserModel: DEFAULT_BROWSER_MODEL,
  ollamaUrl: DEFAULT_OLLAMA_URL,
  ollamaModel: DEFAULT_OLLAMA_MODEL,
});

const MODES: LlmMode[] = ['auto', 'browser', 'ollama', 'cloud', 'offline'];

const str = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim() : fallback);

export const loadLlmSettings = (): LlmSettings => {
  const d = defaultLlmSettings();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return d;
    const p = JSON.parse(raw) as Partial<LlmSettings>;
    return {
      mode: MODES.includes(p.mode as LlmMode) ? (p.mode as LlmMode) : d.mode,
      browserModel: str(p.browserModel, d.browserModel),
      ollamaUrl: str(p.ollamaUrl, d.ollamaUrl),
      ollamaModel: str(p.ollamaModel, d.ollamaModel),
    };
  } catch {
    return d;
  }
};

// Only backend preferences are stored, never prompts or learner answers.
export const saveLlmSettings = (s: LlmSettings) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Storage can be unavailable (private mode); settings then last for the tab.
  }
};
