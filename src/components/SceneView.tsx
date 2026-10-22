import { useEffect, useState } from 'react';
import type { Answered } from '../App';
import type { Chain } from '../data/chains';
import { CHAPTERS, TERM_BY_ID } from '../data/terms';
import type { Expedition, SceneRequest } from '../engine/director';
import { levelOf, STAGE_NAMES, type TermProgress } from '../engine/progress';
import { MODE_LABELS, type Choice, type Scene } from '../engine/scene';
import { RISK_STEPS, suggestedRisk } from '../engine/scoring';
import type { NoteVerdict } from '../llm';

type Props = {
  expedition: Expedition;
  chain: Chain;
  req: SceneRequest | null;
  scene: Scene | null;
  loading: boolean;
  notice: string | null;
  answered: Answered | null;
  verdict: NoteVerdict | null;
  progress: TermProgress | undefined;
  canDefer: boolean;
  onChoose: (choice: Choice, risk: number) => void;
  onNote: (note: string) => Promise<void>;
  onContinue: () => void;
  onDefer: () => void;
  onLeave: () => void;
  onRetry: () => void;
};

function Meter({ label, value, invert }: { label: string; value: number; invert?: boolean }) {
  const good = invert ? 100 - value : value;
  return (
    <div className="meter">
      <span>{label}</span>
      <div className="bar" role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
        <span className={good >= 60 ? 'ok' : good >= 35 ? 'warn' : 'bad'} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

export function SceneView(props: Props) {
  const { expedition, chain, req, scene, loading, notice, answered, verdict, progress } = props;
  const level = progress ? levelOf(progress) : 'Unknown';
  const [lo, hi] = suggestedRisk(level);
  const [risk, setRisk] = useState(1);
  const [note, setNote] = useState('');
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    setNote('');
    setRisk(lo);
  }, [scene, lo]);

  const checkNote = async () => {
    setChecking(true);
    await props.onNote(note);
    setChecking(false);
  };

  return (
    <div className="scene-layout">
      <aside className="scene-side card">
        <h2>{chain.title}</h2>
        <p className="path">{chain.path}</p>
        <ol className="links progress-links">
          {chain.steps.map((s, i) => (
            <li
              key={i}
              className={i < expedition.stepIndex || (expedition.status === 'complete') ? 'done' : i === expedition.stepIndex ? 'current' : ''}
            >
              <span className="dot" />Ch.{s.chapter} · {TERM_BY_ID.get(s.anchor)?.term}
            </li>
          ))}
        </ol>
        <Meter label="Team trust" value={expedition.meters.trust} />
        <Meter label="Budget" value={expedition.meters.budget} />
        <Meter label="Risk exposure" value={expedition.meters.risk} invert />
        <p className="cue"><strong>Exam cue:</strong> {chain.cue}</p>
        <button className="ghost" onClick={props.onLeave}>Return to map</button>
      </aside>

      <section className="scene card" aria-live="polite">
        {req && (
          <div className="scene-meta">
            <span className="badge">Ch. {req.step.chapter} · {CHAPTERS[req.step.chapter].region}</span>
            <span className="badge">{MODE_LABELS[req.mode]}</span>
            <span className="badge">{req.setting.name}{req.setting.kind === 'familiar' ? ' (analogy)' : ''}</span>
            {scene && <span className="badge subtle">{scene.source === 'ai' ? 'AI-written' : 'Offline engine'}</span>}
            {scene?.review && scene.source === 'ai' && (
              <span className="badge subtle" title="GAN-inspired check: drafts are graded against the template and the exam definition before you see them">
                Discriminator: passed{scene.review.rejected ? ` after ${scene.review.rejected} rejected draft${scene.review.rejected > 1 ? 's' : ''}` : ''}
                {scene.review.critic === 'agreed' ? ' · critic agreed' : ''}
              </span>
            )}
            {req?.confirming && <span className="badge">Confirmation</span>}
          </div>
        )}
        {notice && <p className="notice">{notice}</p>}
        {loading && <p className="loading">The story is being written…</p>}
        {!loading && !scene && <button onClick={props.onRetry}>Write the scene</button>}

        {scene && (
          <>
            <div className="narration">
              {scene.narration.split(/\n+/).map((para, i) => <p key={i}>{para}</p>)}
            </div>
            <h3 className="prompt">{scene.prompt}</h3>

            {!answered && (
              <div className="stake">
                <label htmlFor="risk">Confidence stake: <strong>{risk}×</strong></label>
                <div className="risk-steps" role="radiogroup" aria-label="Confidence stake">
                  {RISK_STEPS.map((r) => (
                    <button
                      key={r}
                      role="radio"
                      aria-checked={risk === r}
                      className={risk === r ? 'risk active' : r >= lo && r <= hi ? 'risk suggested' : 'risk'}
                      onClick={() => setRisk(r)}
                    >
                      {r}×
                    </button>
                  ))}
                </div>
                <small>Suggested for {level === 'Unknown' ? 'an' : 'a'} {level.toLowerCase()} concept: {lo}×–{hi}×. Stakes above 1× cost points on a miss.</small>
              </div>
            )}

            <ul className="choices">
              {scene.choices.map((c) => {
                const state = !answered ? '' : c.correct ? 'right' : answered.choice.id === c.id ? 'wrong' : 'dim';
                return (
                  <li key={c.id}>
                    <button className={`choice ${state}`} disabled={Boolean(answered)} onClick={() => props.onChoose(c, risk)}>
                      <span className="choice-id">{c.id.toUpperCase()}</span>
                      <span>{c.text}</span>
                    </button>
                    {answered && (c.correct || answered.choice.id === c.id) && <p className="explain">{c.explanation}</p>}
                  </li>
                );
              })}
            </ul>

            {props.canDefer && (
              <div className="defer">
                <p>This link has been tough. You can keep at it, or park it in the rematch queue and move on.</p>
                <button className="ghost" onClick={props.onDefer}>Park it for later</button>
              </div>
            )}

            {answered && req && (
              <div className={answered.choice.correct ? 'result good' : 'result bad'}>
                <p className="result-head">
                  {answered.choice.correct ? 'Good call.' : 'Not quite.'}{' '}
                  <span>{answered.points >= 0 ? '+' : ''}{answered.points} pts</span>
                </p>
                <p><em>What happens:</em> {answered.choice.consequence}</p>
                <p className={`gate ${answered.gate.advance ? 'go' : 'hold'}`}>
                  <strong>{answered.gate.advance ? 'Next link' : 'Same link'}</strong> — {answered.gate.reason}
                  <small> Decided by {answered.gate.decidedBy === 'rules' ? 'the mastery rules (progress model still learning)' : 'the mastery rules and the LSTM progress model'}.</small>
                </p>
                <div className="definition">
                  <strong>{req.anchor.term}</strong> — {req.anchor.definition}
                  {req.contrast && <p className="clue">Deciding clue vs {req.contrast.partner.term}: {req.contrast.clue}</p>}
                  {progress && <small>Now: {levelOf(progress)} · terminology stage {STAGE_NAMES[progress.stage]}</small>}
                </div>
                <div className="field-note">
                  <label htmlFor="note">Field notes — {scene.socratic}</label>
                  <textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Optional: explain it in your own words." />
                  <button onClick={checkNote} disabled={!note.trim() || checking}>{checking ? 'Thinking…' : 'Check my reasoning'}</button>
                  {verdict && <p className={`verdict ${verdict.verdict}`}>{verdict.feedback}</p>}
                </div>
                <button className="primary" onClick={props.onContinue}>
                  {expedition.status === 'complete' ? 'See how it ends' : answered.gate.advance ? 'Onward' : answered.choice.correct ? 'Confirm from a new angle' : 'Try this link again'}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
