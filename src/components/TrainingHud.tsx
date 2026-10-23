// The round's training goal beside the scene: where the loss stands against the
// target, how it has moved, and how many correct answers would get it there.
import { TERM_BY_ID } from '../data/terms';
import { effectsOf, RUN_GOAL, stepsToTarget, type RunState } from '../engine/run';
import { PixelIcon } from './PixelIcon';

const W = 240;
const H = 60;

export function TrainingHud({ run }: { run: RunState }) {
  const r = run.round;
  if (!r) return null;
  const fx = effectsOf(run.upgrades);
  const cap = fx.lossCap;
  const need = stepsToTarget(run);
  const points = [fx.startLoss, ...r.steps.map((s) => s.loss)];
  const xStep = points.length > 1 ? W / (points.length - 1) : 0;
  const y = (loss: number) => H - (Math.min(cap, loss) / cap) * (H - 4) - 2;
  const met = r.loss <= r.target;
  return (
    <section className="training" aria-label="Training goal">
      <p className="eyebrow"><PixelIcon name="zap" /> Round {run.roundsCleared + run.roundsFailed + 1} · {run.roundsCleared}/{RUN_GOAL} cleared</p>
      <p className="hud-loss">
        <span title={`The run's training goal, moved by every link: a correct answer lowers it, a miss raises it. Loss: ${TERM_BY_ID.get('loss')?.definition ?? ''}`}>Run loss</span>
        <strong className="mono">{r.loss.toFixed(2)}</strong>
        <span className="small">target ≤ {r.target.toFixed(2)}</span>
      </p>
      <div className="bar loss-bar" role="meter" aria-label="Loss toward the target" aria-valuenow={r.loss} aria-valuemin={0} aria-valuemax={cap}>
        <span className={met ? 'ok' : r.loss <= r.target * 1.6 ? 'warn' : 'bad'} style={{ width: `${(Math.min(cap, r.loss) / cap) * 100}%` }} />
        <i className="target-mark" style={{ left: `${(r.target / cap) * 100}%` }} aria-hidden="true" />
      </div>
      <svg className="sparkline" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        <line x1={0} x2={W} y1={y(r.target)} y2={y(r.target)} className="spark-target" />
        <polyline points={points.map((p, i) => `${i * xStep},${y(p)}`).join(' ')} className="spark-line" />
        {r.steps.map((s, i) => <rect key={i} x={(i + 1) * xStep - 2} y={y(s.loss) - 2} width={4} height={4} className={s.correct ? 'spark-dot ok' : 'spark-dot bad'} />)}
      </svg>
      <p className="small">
        {met
          ? <><PixelIcon name="check" /> Under the target. Hold it until the chain completes.</>
          : need === null
            ? 'Out of reach this round; upgrades in the workshop change that.'
            : `${need} correct answer${need === 1 ? '' : 's'} in a row would reach it.`}
        {' '}{r.steps.length} step{r.steps.length === 1 ? '' : 's'}, {r.misses} miss{r.misses === 1 ? '' : 'es'}.
      </p>
    </section>
  );
}
