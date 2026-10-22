import { useState } from 'react';
import type { SaveStatus } from '../App';
import { BROWSER_MODEL_OPTIONS, type LlmMode, type LlmSettings } from '../llm/config';
import { hasWebGpu, isBrowserModelReady, preloadBrowserModel } from '../llm/webllm';
import type { CloudConfig } from '../sync/cloud';

type Props = {
  llm: LlmSettings;
  onLlm: (s: LlmSettings) => void;
  cloud: CloudConfig;
  onCloud: (c: CloudConfig) => void;
  onLoadCloud: () => void;
  save: SaveStatus;
};

const MODES: { id: LlmMode; label: string; help: string }[] = [
  { id: 'auto', label: 'Auto', help: 'Use the browser model once loaded, else the Cloudflare model if connected, else offline.' },
  { id: 'browser', label: 'In-browser (WebLLM)', help: 'Runs on your GPU through WebGPU. Private; first load downloads about 2 GB.' },
  { id: 'cloud', label: 'Cloudflare Workers AI', help: 'Your Worker generates scenes with Workers AI. Needs the backend below.' },
  { id: 'ollama', label: 'Ollama (local server)', help: 'A model served by Ollama on this machine.' },
  { id: 'offline', label: 'Offline engine only', help: 'Scenes built from the term bank and chains. Instant, no AI.' },
];

export function SettingsPanel({ llm, onLlm, cloud, onCloud, onLoadCloud, save }: Props) {
  const [progress, setProgress] = useState('');
  const [loading, setLoading] = useState(false);
  const ready = isBrowserModelReady(llm.browserModel);

  const load = async () => {
    setLoading(true);
    try {
      const ok = await preloadBrowserModel(llm.browserModel, setProgress);
      setProgress(ok ? 'Model ready. New scenes will be AI-written.' : 'WebGPU is not available in this browser.');
    } catch (error) {
      setProgress(error instanceof Error ? error.message : 'Model failed to load.');
    }
    setLoading(false);
  };

  return (
    <div className="settings">
      <section className="card">
        <h1>Scenario AI</h1>
        <fieldset className="modes">
          <legend>Who writes the scenes</legend>
          {MODES.map((m) => (
            <label key={m.id} className="mode">
              <input type="radio" name="mode" checked={llm.mode === m.id} onChange={() => onLlm({ ...llm, mode: m.id })} />
              <span><strong>{m.label}</strong><small>{m.help}</small></span>
            </label>
          ))}
        </fieldset>

        <h2>In-browser model</h2>
        {!hasWebGpu() && <p className="notice">This browser has no WebGPU, so the in-browser model cannot run here.</p>}
        <label className="field">
          Model
          <select value={llm.browserModel} onChange={(e) => onLlm({ ...llm, browserModel: e.target.value })}>
            {BROWSER_MODEL_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <button onClick={load} disabled={loading || ready || !hasWebGpu()}>{ready ? 'Loaded' : loading ? 'Loading…' : 'Load model'}</button>
        {progress && <p className="small" role="status">{progress}</p>}

        <h2>Ollama</h2>
        <label className="field">URL<input value={llm.ollamaUrl} onChange={(e) => onLlm({ ...llm, ollamaUrl: e.target.value })} /></label>
        <label className="field">Model<input value={llm.ollamaModel} onChange={(e) => onLlm({ ...llm, ollamaModel: e.target.value })} /></label>
      </section>

      <section className="card">
        <h1>Cloud sync</h1>
        <p>
          Your learning stays in this session (and a local draft) until you press <strong>Save</strong>; then only the
          changes since your last save go to your Cloudflare Worker and its D1 database. See <code>worker/README.md</code> to deploy it.
        </p>
        <label className="field">Worker URL<input placeholder="https://isaca-quest-sync.<you>.workers.dev" value={cloud.url} onChange={(e) => onCloud({ ...cloud, url: e.target.value })} /></label>
        <label className="field">Sync token<input type="password" autoComplete="off" value={cloud.token} onChange={(e) => onCloud({ ...cloud, token: e.target.value })} /></label>
        <p className="small">The token is kept only in this browser's storage and sent as a bearer header.</p>
        <button onClick={onLoadCloud} disabled={!cloud.url || !cloud.token}>Load progress from cloud</button>
        {save.message && <p className={`save-msg ${save.kind}`}>{save.message}</p>}
      </section>
    </div>
  );
}
