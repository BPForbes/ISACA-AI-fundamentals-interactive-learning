// The expedition's side panel, shared by the scene and the lab: the run's training
// goal, the chain's links, the team meters, and the way out.
import type { Chain } from '../data/chains';
import { TERM_BY_ID } from '../data/terms';
import type { Expedition } from '../engine/director';
import type { RunState } from '../engine/run';
import { TrainingHud } from './TrainingHud';

type Props = { expedition: Expedition; run: RunState | null; chain: Chain; onLeave: () => void };

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

export function ExpeditionSide({ expedition, run, chain, onLeave }: Props) {
  const leaving = run?.round && expedition.status === 'active';
  return (
    <aside className="scene-side card">
      {run?.round && <TrainingHud run={run} />}
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
      <button className="ghost" onClick={onLeave} title={leaving ? 'Leaving before the chain completes fails the round' : undefined}>
        {leaving ? 'Abandon the round' : 'Return to the workshop'}
      </button>
    </aside>
  );
}
