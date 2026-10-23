import { CHAINS } from '../data/chains';
import { CHAPTERS, TERM_BY_ID, termsInChapter, type ChapterId } from '../data/terms';
import { levelOf } from '../engine/progress';
import type { RunState } from '../engine/run';
import type { Backend } from '../llm';
import type { SessionState } from '../session/store';
import { PixelIcon } from './PixelIcon';
import { RunOver, Workshop } from './Workshop';

type Props = {
  session: SessionState;
  recommendedId: string;
  backend: Backend;
  run: RunState | null;
  onStart: (chainId: string) => void;
  onStartProject: () => void;
  onBuy: (id: string) => void;
  onNewRun: () => void;
  onSettings: () => void;
};

const LEVEL_SCORE: Record<string, number> = { Unknown: 0, Familiar: 0.35, Competent: 0.65, Proficient: 0.9, Mastered: 1 };

export function MapView({ session, recommendedId, backend, run, onStart, onStartProject, onBuy, onNewRun, onSettings }: Props) {
  const over = run?.phase === 'over';
  const chapterMastery = (c: ChapterId) => {
    const terms = termsInChapter(c);
    const total = terms.reduce((sum, t) => {
      const p = session.progress[t.id];
      return sum + LEVEL_SCORE[p ? levelOf(p) : 'Unknown'];
    }, 0);
    return Math.round((total / terms.length) * 100);
  };

  return (
    <div className="map">
      {run && !over && <Workshop run={run} onBuy={onBuy} onStart={onStartProject} />}
      {run && over && <RunOver run={run} onNewRun={onNewRun} />}
      <section className="intro card">
        <h2>Five regions, one lifecycle.</h2>
        <p>
          The lab's goals are drawn from all five chapters, and each project runs the lifecycle once. Below, the
          story expeditions are practice outside the run: one integration chain through the chapters, where you advise
          a team and the story only moves on once the concept at each link holds up.
        </p>
        {backend === 'offline' && (
          <p className="hint">
            The offline story engine is running. For AI-written scenarios, load the in-browser model or connect the
            Cloudflare backend in <button className="link" onClick={onSettings}>Settings</button>.
          </p>
        )}
      </section>

      <section className="regions" aria-label="Chapter regions">
        {([1, 2, 3, 4, 5] as ChapterId[]).map((c) => (
          <div key={c} className={`region region-${c}`}>
            <span className="region-ch">Ch. {c}</span>
            <strong>{CHAPTERS[c].region}</strong>
            <small>{CHAPTERS[c].question}</small>
            <div className="bar" role="meter" aria-valuenow={chapterMastery(c)} aria-valuemin={0} aria-valuemax={100} aria-label={`Chapter ${c} mastery`}>
              <span style={{ width: `${chapterMastery(c)}%` }} />
            </div>
          </div>
        ))}
      </section>

      {session.remediation.length > 0 && (
        <section className="card remediation">
          <h2>Waiting for a rematch</h2>
          <p>Concepts you missed stay in the queue until two correct answers in a row clear them.</p>
          <ul className="chips">
            {session.remediation.map((id) => <li key={id}>{TERM_BY_ID.get(id)?.term ?? id}</li>)}
          </ul>
        </section>
      )}

      <section aria-label="Expeditions">
        <h2>Story expeditions (practice, outside the run)</h2>
        <div className="chains">
          {CHAINS.map((chain) => (
            <article key={chain.id} className={chain.id === recommendedId ? 'chain card recommended' : 'chain card'}>
              {chain.id === recommendedId && <span className="ribbon">Recommended</span>}
              <h3>{chain.title}</h3>
              <p className="path">{chain.path}</p>
              <ol className="links">
                {chain.steps.map((s, i) => {
                  const p = session.progress[s.anchor];
                  const level = p ? levelOf(p) : 'Unknown';
                  return (
                    <li key={i} className={`lvl-${level.toLowerCase()}`} title={`${TERM_BY_ID.get(s.anchor)?.term}: ${level}`}>
                      <span className="dot" />Ch.{s.chapter} {TERM_BY_ID.get(s.anchor)?.term}
                    </li>
                  );
                })}
              </ol>
              <button onClick={() => onStart(chain.id)}><PixelIcon name="gamepad" /> Play the story</button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
