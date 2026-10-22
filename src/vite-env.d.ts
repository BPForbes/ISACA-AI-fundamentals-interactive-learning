/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WEBLLM_MODEL?: string;
  readonly VITE_OLLAMA_URL?: string;
  readonly VITE_OLLAMA_MODEL?: string;
  readonly VITE_SYNC_URL?: string;
}
