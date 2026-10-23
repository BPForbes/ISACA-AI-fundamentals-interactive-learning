import type { SaveStatus } from '../App';
import type { Backend } from '../llm';
import { RUN_GOAL, type RunState } from '../engine/run';
import type { SessionStats } from '../session/store';
import { TARGET_POINTS } from '../session/store';
import { PixelIcon } from './PixelIcon';

const BACKEND_LABEL: Record<Backend, string> = {
  hosted: 'AI: free hosted model',
  browser: 'AI: in-browser model',
  ollama: 'AI: Ollama',
  cloud: 'AI: Cloudflare',
  offline: 'Offline story engine',
};

type Props = {
  stats: SessionStats;
  run: RunState | null;
  backend: Backend;
  modelStatus: string | null;
  unsaved: number;
  cloudReady: boolean;
  save: SaveStatus;
  view: string;
  onView: (v: 'map' | 'journal' | 'settings') => void;
  onSave: () => void;
};

export function Header({ stats, run, backend, modelStatus, unsaved, cloudReady, save, view, onView, onSave }: Props) {
  const accuracy = stats.answered ? Math.round((stats.correct / stats.answered) * 100) : 0;
  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">◆</span>
        <div>
          <strong>Training Run</strong>
          <small>ISACA AI Fundamentals · Chapters 1–5</small>
        </div>
      </div>
      <nav className="tabs" aria-label="Sections">
        {(['map', 'journal', 'settings'] as const).map((v) => (
          <button key={v} className={view === v ? 'tab active' : 'tab'} onClick={() => onView(v)} aria-current={view === v}>
            {v === 'map' ? 'Run' : v === 'journal' ? 'Journal' : 'Settings'}
          </button>
        ))}
      </nav>
      <div className="hud" aria-label="Session score">
        {run && (
          <span className="badge run-badge" title={run.phase === 'over' ? 'This run is over' : 'The model in training, rounds cleared, and credits for the workshop'}>
            <PixelIcon name="cpu" /> {run.codename} · <PixelIcon name="flag" /> {run.roundsCleared}/{RUN_GOAL} · <PixelIcon name="coins" /> {run.credits}
          </span>
        )}
        <span title="Points toward the session target">{stats.points} / {TARGET_POINTS} pts</span>
        <span title="Accuracy this session">{accuracy}% acc</span>
        <span title="Current streak (multiplier is the square root)">🔥 {stats.streak}</span>
        <span className={`badge backend-${backend}`} title={modelStatus ?? undefined}>
          {modelStatus ? 'Loading cached model…' : BACKEND_LABEL[backend]}
        </span>
        {/* Without cloud sync, learning is kept on this device after every answer; the count is what the cloud lacks. */}
        <button
          className={cloudReady && unsaved > 0 ? 'save-btn pending' : 'save-btn'}
          onClick={onSave}
          disabled={save.kind === 'saving'}
          title={cloudReady ? 'Send this session\'s learning to the cloud' : 'Saved on this device after every answer. Add a sync token in Settings to back it up to the cloud.'}
        >
          {save.kind === 'saving' ? 'Saving…' : !cloudReady ? 'Save' : unsaved > 0 ? `Save (${unsaved})` : 'Saved'}
        </button>
      </div>
      {save.message && save.kind !== 'idle' && (
        <p className={`save-msg ${save.kind}`} role="status">{save.message}</p>
      )}
    </header>
  );
}
