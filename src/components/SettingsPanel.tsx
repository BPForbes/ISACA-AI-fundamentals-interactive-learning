import { useEffect, useState } from 'react';
import type { SaveStatus } from '../App';
import { BROWSER_MODEL_OPTIONS, type LlmMode, type LlmSettings } from '../llm/config';
import {
  chooseModel, completeWithHosted, HOSTED_PROVIDERS, listHostedModels, modelOf, type HostedConfig, type HostedProviderId,
} from '../llm/hosted';
import { hasWebGpu, isBrowserModelReady, isModelCached, preloadBrowserModel, removeCachedBrowserModel } from '../llm/webllm';
import type { CloudConfig } from '../sync/cloud';

type Props = {
  llm: LlmSettings;
  onLlm: (s: LlmSettings) => void;
  cloud: CloudConfig;
  onCloud: (c: CloudConfig) => void;
  onLoadCloud: () => void;
  save: SaveStatus;
  hosted: HostedConfig;
  onHosted: (c: HostedConfig) => void;
};

const MODES: { id: LlmMode; label: string; help: string }[] = [
  { id: 'auto', label: 'Auto (recommended)', help: 'The strongest AI that is ready: free hosted model, then the in-browser model, then Cloudflare, else offline.' },
  { id: 'hosted', label: 'Free hosted model', help: 'A large model on Groq, Gemini or OpenRouter, with your own free API key.' },
  { id: 'browser', label: 'In-browser (WebLLM)', help: 'Runs on your GPU through WebGPU. Private; first load downloads 1–5 GB.' },
  { id: 'cloud', label: 'Cloudflare Workers AI (last resort)', help: 'Your Worker generates scenes with Workers AI. Needs the backend below.' },
  { id: 'ollama', label: 'Ollama (local server)', help: 'A model served by Ollama on this machine.' },
  { id: 'offline', label: 'Offline engine only', help: 'Scenes built from the term bank and chains. Instant, no AI.' },
];

export function SettingsPanel({ llm, onLlm, cloud, onCloud, onLoadCloud, save, hosted, onHosted }: Props) {
  const [progress, setProgress] = useState('');
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [hostedStatus, setHostedStatus] = useState('');
  const provider = HOSTED_PROVIDERS[hosted.provider];

  const loadModels = async () => {
    setHostedStatus('Loading models…');
    try {
      const list = await listHostedModels(hosted);
      setModels(list);
      const model = chooseModel(hosted, list);
      onHosted({ ...hosted, model });
      setHostedStatus(list.length ? `${list.length} models available; selected ${model}.` : 'The provider listed no usable models.');
    } catch (error) {
      setHostedStatus(error instanceof Error ? error.message : 'Could not load the model list.');
    }
  };

  const testHosted = async () => {
    setHostedStatus('Testing…');
    try {
      const reply = await completeWithHosted(hosted, 'Reply with JSON only.', 'Return {"ok": true}.', 20);
      setHostedStatus(reply ? `Connected to ${modelOf(hosted)}. New scenes will be written by it.` : 'Connected, but the model returned nothing.');
    } catch (error) {
      setHostedStatus(error instanceof Error ? error.message : 'The request failed (the provider may not allow browser requests).');
    }
  };
  const ready = isBrowserModelReady(llm.browserModel);
  const [cached, setCached] = useState(false);
  useEffect(() => {
    let active = true;
    void isModelCached(llm.browserModel).then((c) => active && setCached(c));
    return () => {
      active = false;
    };
  }, [llm.browserModel, ready]);

  const remove = async () => {
    if (!window.confirm(`Remove ${llm.browserModel} from this device? It will need to download again to use it.`)) return;
    await removeCachedBrowserModel(llm.browserModel);
    setCached(false);
    setProgress('Removed from this device.');
  };

  const load = async () => {
    setLoading(true);
    try {
      const ok = await preloadBrowserModel(llm.browserModel, setProgress);
      setProgress(ok ? 'Model ready and cached on this device. It will load automatically next time, with no download.' : 'WebGPU is not available in this browser.');
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

        <h2>Free hosted model</h2>
        <p className="small">
          The strongest free option: a large model on a provider's free tier, called directly from this page with your
          own key. The key is stored only in this browser and sent only to {provider.label}.
        </p>
        <label className="field">
          Provider
          <select
            value={hosted.provider}
            onChange={(e) => {
              setModels([]);
              setHostedStatus('');
              onHosted({ ...hosted, provider: e.target.value as HostedProviderId, model: '' });
            }}
          >
            {Object.values(HOSTED_PROVIDERS).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <p className="small">
          {provider.note}{' '}
          {provider.keyUrl && <a href={provider.keyUrl} target="_blank" rel="noreferrer noopener">Get a free key</a>}
        </p>
        {hosted.provider === 'custom' && (
          <label className="field">Base URL<input placeholder="https://…/v1" value={hosted.baseUrl} onChange={(e) => onHosted({ ...hosted, baseUrl: e.target.value })} /></label>
        )}
        <label className="field">
          API key
          <input type="password" autoComplete="off" value={hosted.apiKey} onChange={(e) => onHosted({ ...hosted, apiKey: e.target.value })} />
        </label>
        <label className="field">
          Model
          <input list="hosted-models" placeholder={provider.defaultModel || 'Load the list'} value={hosted.model} onChange={(e) => onHosted({ ...hosted, model: e.target.value })} />
          <datalist id="hosted-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
        </label>
        <div className="row">
          <button onClick={loadModels} disabled={!hosted.apiKey}>Load model list</button>
          <button onClick={testHosted} disabled={!hosted.apiKey || !modelOf(hosted)}>Test</button>
        </div>
        {hostedStatus && <p className="small" role="status">{hostedStatus}</p>}

        <h2>Discriminator</h2>
        <p className="small">
          AI drafts are rewritten from a template scene built from your term bank, then graded against that template and
          the exam definition before you see them. Rejected drafts go back to the generator with the reasons.
        </p>
        <fieldset className="modes">
          <legend>How drafts are checked</legend>
          <label className="mode">
            <input type="radio" name="disc" checked={llm.discriminator === 'rules'} onChange={() => onLlm({ ...llm, discriminator: 'rules' })} />
            <span><strong>Rules</strong><small>Answer key matches the definition, no giveaway, one right answer, real near-miss distractors. Instant.</small></span>
          </label>
          <label className="mode">
            <input type="radio" name="disc" checked={llm.discriminator === 'rules+ai'} onChange={() => onLlm({ ...llm, discriminator: 'rules+ai' })} />
            <span><strong>Rules + AI critic</strong><small>The model also answers each draft blind; a draft it answers differently is rejected. One extra call per draft.</small></span>
          </label>
        </fieldset>
        <label className="field">
          Drafts before using the template
          <select value={llm.rounds} onChange={(e) => onLlm({ ...llm, rounds: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>

        <h2>In-browser model</h2>
        {!hasWebGpu() && <p className="notice">This browser has no WebGPU, so the in-browser model cannot run here.</p>}
        <label className="field">
          Model
          <select value={llm.browserModel} onChange={(e) => onLlm({ ...llm, browserModel: e.target.value })}>
            {BROWSER_MODEL_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <p className="small">
          {ready ? 'Loaded. ' : ''}{cached
            ? 'Cached on this device: it loads automatically on each visit without downloading again.'
            : 'Not cached yet: the first load downloads it once, then it is kept on this device.'}
        </p>
        <div className="row">
          <button onClick={load} disabled={loading || ready || !hasWebGpu()}>
            {ready ? 'Loaded' : loading ? 'Loading…' : cached ? 'Load from cache' : 'Download and cache'}
          </button>
          {cached && <button className="ghost" onClick={remove} disabled={loading}>Remove from this device</button>}
        </div>
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
