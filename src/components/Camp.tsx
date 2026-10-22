import { CHAIN_BY_ID } from '../data/chains';
import { TERM_BY_ID } from '../data/terms';
import { buildSceneRequest } from '../engine/director';
import { levelOf } from '../engine/progress';
import { MODE_LABELS } from '../engine/scene';
import type { SaveStatus } from '../App';
import { hasUnsavedChanges, TARGET_POINTS, type SessionState } from '../session/store';

type Props = {
  session: SessionState;
  cloudReady: boolean;
  save: SaveStatus;
  onSave: () => void;
  onClose: () => void;
};

// The guide's queue refresh every 5–8 questions, staged as a camp: a short
// look at where things stand, and the natural moment to save.
export function Camp({ session, cloudReady, save, onSave, onClose }: Props) {
  const exp = session.expedition;
  const chain = exp ? CHAIN_BY_ID.get(exp.chainId) : undefined;
  const next = exp && exp.status === 'active' ? buildSceneRequest(exp, (id) => session.progress[id]) : null;
  const s = session.stats;
  const accuracy = s.answered ? Math.round((s.correct / s.answered) * 100) : 0;
  const anchorProgress = next ? session.progress[next.anchor.id] : undefined;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="camp-title">
      <div className="modal card">
        <h2 id="camp-title">Camp — a quick look back</h2>
        <dl className="camp-stats">
          <div><dt>Score</dt><dd>{s.points} / {TARGET_POINTS}</dd></div>
          <div><dt>Accuracy</dt><dd>{accuracy}% ({s.correct}/{s.answered})</dd></div>
          <div><dt>Streak</dt><dd>{s.streak} (best {s.longestStreak})</dd></div>
        </dl>
        {chain && <p><strong>Active expedition:</strong> {chain.title} — still locked until its links hold.</p>}
        {next && (
          <p>
            <strong>Next link:</strong> {next.anchor.term} ({anchorProgress ? levelOf(anchorProgress) : 'Unknown'}).
            Mode: {MODE_LABELS[next.mode]}, drawing on Ch. {[...new Set([next.step.chapter, ...next.supporting.map((t) => t.chapter)])].join(', ')}.
          </p>
        )}
        {session.remediation.length > 0 && (
          <p><strong>Rematch queue:</strong> {session.remediation.map((id) => TERM_BY_ID.get(id)?.term ?? id).join(', ')}</p>
        )}
        {s.points >= TARGET_POINTS && <p className="hint">You've hit today's point target. Stopping here is fine; points never mark a topic as mastered.</p>}
        <p className="hint">
          {hasUnsavedChanges(session)
            ? cloudReady
              ? 'Your progress lives in this session until you save it to the cloud.'
              : 'Your progress lives in this browser. Connect cloud sync in Settings to keep it safe.'
            : 'Everything is saved.'}
        </p>
        {save.message && <p className={`save-msg ${save.kind}`}>{save.message}</p>}
        <div className="row">
          {cloudReady && hasUnsavedChanges(session) && (
            <button onClick={onSave} disabled={save.kind === 'saving'}>{save.kind === 'saving' ? 'Saving…' : 'Save to cloud'}</button>
          )}
          <button className="primary" onClick={onClose}>Break camp</button>
        </div>
      </div>
    </div>
  );
}
