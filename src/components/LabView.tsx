// The lab: a challenge's brief and goal, and the three stages of the pipeline the
// learner can work on (data, training, evaluation). Every control change re-runs
// the lab, so the learner sees what the concept does before submitting. The lab
// decides nothing about mastery: it reports the result and the challenge's goal.
import { useEffect, useMemo, useState } from 'react';
import type { Chain } from '../data/chains';
import type { Challenge, Stage } from '../data/challenges';
import type { StorySetting } from '../data/settings';
import { TERM_BY_ID } from '../data/terms';
import type { Expedition, SceneRequest } from '../engine/director';
import { runLab, type LabConfig, type LabResult } from '../engine/lab';
import type { Sampling } from '../engine/lab/dataset';
import { METRIC_IDS, type MetricId } from '../engine/lab/metrics';
import { BATCH_SIZES, HIDDEN_SIZES, L2_STEPS, LEARNING_RATES, MAX_EPOCHS } from '../engine/lab/model';
import type { RunState } from '../engine/run';
import type { GateDecision } from '../engine/tracker';
import { ExpeditionSide } from './ExpeditionSide';
import { PixelIcon } from './PixelIcon';

export type LabAnswered = { correct: boolean; points: number; gate: GateDecision; readout: string };

type Props = {
  expedition: Expedition;
  run: RunState | null;
  chain: Chain;
  req: SceneRequest;
  challenge: Challenge;
  setting: StorySetting;
  seed: number;
  answered: LabAnswered | null;
  // Misses on this link so far; the hint opens after the second.
  misses: number;
  canDefer: boolean;
  onSubmit: (result: LabResult) => void;
  onContinue: () => void;
  onDefer: () => void;
  onLeave: () => void;
};

const STAGE_LABELS: Record<Stage, string> = { data: 'Data', train: 'Training', evaluate: 'Evaluation' };

const term = (id: string) => TERM_BY_ID.get(id);
const Term = ({ id, children }: { id: string; children?: string }) => {
  const t = term(id);
  return <span className="term" title={t ? `${t.term}: ${t.definition}` : undefined}>{children ?? t?.term ?? id}</span>;
};

// Plain names for the controls a hint can point at.
const CONTROL_NAMES: Record<string, string> = {
  sampling: 'the sampling method', sampleSize: 'the sample size', cleanse: 'cleansing', verifyLabels: 'the label check',
  augment: 'augmentation', recent: 'retraining on recent cases', depth: 'the depth', hidden: 'the units per layer', learningRate: 'the learning rate',
  epochs: 'the epochs', batchSize: 'the batch size', l2: 'regularization', threshold: 'the threshold', assessOn: 'which rows are assessed',
  kpi: 'the KPI',
};

const differences = (a: LabConfig, b: LabConfig): string[] => {
  const out: string[] = [];
  for (const k of Object.keys(a.data) as (keyof LabConfig['data'])[]) if (a.data[k] !== b.data[k] && CONTROL_NAMES[k]) out.push(CONTROL_NAMES[k]);
  for (const k of Object.keys(a.model) as (keyof LabConfig['model'])[]) if (a.model[k] !== b.model[k] && CONTROL_NAMES[k]) out.push(CONTROL_NAMES[k]);
  if (a.threshold !== b.threshold) out.push(CONTROL_NAMES.threshold);
  if (a.assessOn !== b.assessOn) out.push(CONTROL_NAMES.assessOn);
  if (a.kpi !== b.kpi) out.push(CONTROL_NAMES.kpi);
  return out;
};

// ---------- drawings ----------

const W = 260;
const H = 200;
const sx = (x: number) => ((x + 1.2) / 2.4) * W;
const sy = (y: number) => H - ((y + 1.2) / 2.4) * H;

function Scatter({ result, boundary }: { result: LabResult; boundary: boolean }) {
  const { dataset, training } = result;
  const cells = 14;
  const grid = boundary
    ? Array.from({ length: cells * cells }, (_, i) => {
      const gx = -1.2 + ((i % cells) + 0.5) * (2.4 / cells);
      const gy = -1.2 + (Math.floor(i / cells) + 0.5) * (2.4 / cells);
      return { gx, gy, p: training.predict(gx, gy) };
    })
    : [];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="lab-plot" role="img" aria-label={`${dataset.train.length} training rows${boundary ? ' and the model’s decision regions' : ''}`}>
      {grid.map((g, i) => (
        <rect key={i} x={sx(g.gx) - W / cells / 2} y={sy(g.gy) - H / cells / 2} width={W / cells} height={H / cells} className={g.p >= 0.5 ? 'cell pos' : 'cell neg'} style={{ opacity: 0.12 + Math.abs(g.p - 0.5) * 0.5 }} />
      ))}
      {dataset.population.map((p, i) => <circle key={`p${i}`} cx={sx(p.x)} cy={sy(p.y)} r={1.5} className="pop" />)}
      {dataset.train.map((p, i) => (
        p.group === 1
          ? <rect key={`t${i}`} x={sx(p.x) - 3} y={sy(p.y) - 3} width={6} height={6} className={p.label ? 'row pos' : 'row neg'} />
          : <circle key={`t${i}`} cx={sx(p.x)} cy={sy(p.y)} r={3} className={p.label ? 'row pos' : 'row neg'} />
      ))}
    </svg>
  );
}

function Curves({ result }: { result: LabResult }) {
  const curve = result.training.curve;
  const n = Math.max(1, curve.length - 1);
  const top = Math.max(1, ...curve.flatMap((e) => [e.train, e.val]).filter(Number.isFinite));
  const px = (i: number) => (i / n) * W;
  const py = (v: number) => H - (Math.min(top, v) / top) * (H - 6) - 3;
  const line = (key: 'train' | 'val') => curve.map((e, i) => `${px(i)},${py(e[key])}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="lab-plot" role="img" aria-label={`Loss over ${curve.length} epochs: training ${result.trainLoss.toFixed(2)}, validation ${result.valLoss.toFixed(2)}`}>
      {curve.length > 0 && <polyline points={line('train')} className="curve train" />}
      {curve.length > 0 && <polyline points={line('val')} className="curve val" />}
      <text x={4} y={12} className="net-label">loss</text>
      <text x={W - 4} y={H - 4} className="net-label" textAnchor="end">epoch {curve.length}</text>
    </svg>
  );
}

function ScoreStrip({ result }: { result: LabResult }) {
  const t = result.config.threshold;
  return (
    <svg viewBox={`0 0 ${W} 70`} className="lab-plot strip" role="img" aria-label={`Validation cases by model score; threshold ${t.toFixed(2)}`}>
      <text x={2} y={22} className="net-label">actual +</text>
      <text x={2} y={56} className="net-label">actual −</text>
      {result.validation.map((s, i) => (
        <circle key={i} cx={40 + s.score * (W - 44)} cy={s.label ? 18 + (i % 5) * 2 : 52 + (i % 5) * 2} r={2.2} className={(s.score >= t) === (s.label === 1) ? 'row pos' : 'row neg'} />
      ))}
      <line x1={40 + t * (W - 44)} x2={40 + t * (W - 44)} y1={4} y2={66} className="spark-target" />
    </svg>
  );
}

// ---------- panels ----------

type PanelProps = { config: LabConfig; result: LabResult; onChange: (c: LabConfig) => void; disabled: boolean };

function DataPanel({ config, result, onChange, disabled }: PanelProps) {
  const d = config.data;
  const set = (patch: Partial<LabConfig['data']>) => onChange({ ...config, data: { ...d, ...patch } });
  const share = result.dataset.groupShare;
  return (
    <div className="lab-panel">
      <Scatter result={result} boundary={false} />
      <div className="lab-controls">
        <fieldset disabled={disabled}>
          <legend><Term id="sampling">Sampling</Term></legend>
          {(['convenience', 'random', 'stratified'] as Sampling[]).map((m) => (
            <label key={m} className="radio">
              <input type="radio" name="sampling" checked={d.sampling === m} onChange={() => set({ sampling: m })} />
              <Term id={`${m}-sampling`}>{m === 'random' ? 'Random (probability)' : m === 'convenience' ? 'Convenience' : 'Stratified'}</Term>
            </label>
          ))}
          <label className="field"><span>Sample size: <strong className="mono">{d.sampleSize}</strong></span>
            <input type="range" min={12} max={200} step={4} value={d.sampleSize} onChange={(e) => set({ sampleSize: Number(e.target.value) })} />
          </label>
          <label className="check"><input type="checkbox" checked={d.cleanse} onChange={(e) => set({ cleanse: e.target.checked })} /> <Term id="data-cleansing">Cleanse</Term>: drop duplicates and impossible readings</label>
          <label className="check"><input type="checkbox" checked={d.verifyLabels} onChange={(e) => set({ verifyLabels: e.target.checked })} /> <Term id="provenance">Check labels against their source</Term></label>
          <label className="check"><input type="checkbox" checked={d.augment} onChange={(e) => set({ augment: e.target.checked })} /> <Term id="data-augmentation">Augment</Term>: add jittered copies</label>
          {d.drift > 0 && <label className="check"><input type="checkbox" checked={d.recent} onChange={(e) => set({ recent: e.target.checked })} /> Retrain on this quarter's cases</label>}
        </fieldset>
      </div>
      <p className="small">
        {result.dataset.sample.length} rows handed over, {result.dataset.train.length} used for training
        {result.dataset.removed ? `, ${result.dataset.removed} removed` : ''}{result.dataset.corrected ? `, ${result.dataset.corrected} labels corrected` : ''}.
        Minority group (squares): {Math.round(share.sample * 100)}% of the sample, {Math.round(share.population * 100)}% of the population.
      </p>
    </div>
  );
}

function TrainPanel({ config, result, onChange, disabled }: PanelProps) {
  const m = config.model;
  const set = (patch: Partial<LabConfig['model']>) => onChange({ ...config, model: { ...m, ...patch } });
  return (
    <div className="lab-panel">
      <div className="lab-plots">
        <Scatter result={result} boundary />
        <Curves result={result} />
      </div>
      <div className="lab-controls">
        <fieldset disabled={disabled}>
          <legend><Term id="hyperparameter">Hyperparameters</Term></legend>
          <div className="field"><Term id="depth">Hidden layers</Term>
            <div className="risk-steps">{([0, 1, 2] as const).map((dp) => <button key={dp} className={m.depth === dp ? 'risk active' : 'risk'} onClick={() => set({ depth: dp })}>{dp}</button>)}</div>
          </div>
          <label className="field"><Term id="neural-network">Units per hidden layer</Term>
            <select value={m.hidden} onChange={(e) => set({ hidden: Number(e.target.value) })}>{HIDDEN_SIZES.map((h) => <option key={h} value={h}>{h}</option>)}</select>
          </label>
          <label className="field"><Term id="learning-rate">Learning rate</Term>
            <select value={m.learningRate} onChange={(e) => set({ learningRate: Number(e.target.value) })}>{LEARNING_RATES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
          </label>
          <label className="field"><span><Term id="epoch">Epochs</Term>: <strong className="mono">{m.epochs}</strong></span>
            <input type="range" min={1} max={MAX_EPOCHS} value={m.epochs} onChange={(e) => set({ epochs: Number(e.target.value) })} />
          </label>
          <label className="field"><Term id="batch">Batch size</Term>
            <select value={m.batchSize} onChange={(e) => set({ batchSize: Number(e.target.value) })}>{BATCH_SIZES.map((b) => <option key={b} value={b}>{b === 120 ? 'all rows' : b}</option>)}</select>
          </label>
          <label className="field"><Term id="regularization">Regularization (L2)</Term>
            <select value={m.l2} onChange={(e) => set({ l2: Number(e.target.value) })}>{L2_STEPS.map((l) => <option key={l} value={l}>{l === 0 ? 'off' : l}</option>)}</select>
          </label>
          <div className="field"><Term id="model-assessment">Report loss on</Term>
            <label className="radio"><input type="radio" name="assess" checked={config.assessOn === 'train'} onChange={() => onChange({ ...config, assessOn: 'train' })} /> training rows</label>
            <label className="radio"><input type="radio" name="assess" checked={config.assessOn === 'validation'} onChange={() => onChange({ ...config, assessOn: 'validation' })} /> held-out rows</label>
          </div>
        </fieldset>
      </div>
      <p className="small">
        <Term id="loss">Loss</Term> after {result.training.curve.length} epochs: training <strong className="mono">{result.trainLoss.toFixed(2)}</strong>, validation <strong className="mono">{result.valLoss.toFixed(2)}</strong>;
        {' '}{result.training.paramCount} <Term id="parameter">parameters</Term>, {result.compute} compute. {result.diagnosis.text}
      </p>
    </div>
  );
}

function EvaluatePanel({ config, result, onChange, disabled }: PanelProps) {
  const m = result.metrics;
  return (
    <div className="lab-panel">
      <ScoreStrip result={result} />
      <div className="lab-controls">
        <fieldset disabled={disabled}>
          <legend>Decision</legend>
          <label className="field"><span>Threshold: <strong className="mono">{config.threshold.toFixed(2)}</strong></span>
            <input type="range" min={0.05} max={0.95} step={0.05} value={config.threshold} onChange={(e) => onChange({ ...config, threshold: Number(e.target.value) })} />
          </label>
          <label className="field"><Term id="kpi">Report as the KPI</Term>
            <select value={config.kpi ?? ''} onChange={(e) => onChange({ ...config, kpi: (e.target.value || null) as MetricId | null })}>
              <option value="">none chosen</option>
              {METRIC_IDS.map((id) => <option key={id} value={id}>{term(id)?.term ?? id}</option>)}
            </select>
          </label>
        </fieldset>
      </div>
      <table className="confusion" aria-label="Confusion matrix on the validation cases">
        <thead><tr><th /><th>Predicted +</th><th>Predicted −</th></tr></thead>
        <tbody>
          <tr><th>Actual +</th><td title={term('tp')?.definition}><Term id="tp">TP</Term> <strong className="mono">{m.tp}</strong></td><td title={term('fn')?.definition}><Term id="fn">FN</Term> <strong className="mono">{m.fn}</strong></td></tr>
          <tr><th>Actual −</th><td title={term('fp')?.definition}><Term id="fp">FP</Term> <strong className="mono">{m.fp}</strong></td><td title={term('tn')?.definition}><Term id="tn">TN</Term> <strong className="mono">{m.tn}</strong></td></tr>
        </tbody>
      </table>
      <ul className="metrics">
        {METRIC_IDS.map((id) => <li key={id} className={config.kpi === id ? 'kpi' : ''}><Term id={id} /> <strong className="mono">{Math.round(m[id] * 100)}%</strong></li>)}
        <li><Term id="fairness-testing">Group accuracy</Term> <strong className="mono">{Math.round(result.groups.majority * 100)}% / {Math.round(result.groups.minority * 100)}%</strong></li>
        {config.data.drift > 0 && <li>Latest cases: accuracy <strong className="mono">{Math.round(result.testMetrics.accuracy * 100)}%</strong></li>}
      </ul>
    </div>
  );
}

// ---------- the view ----------

export function LabView(props: Props) {
  const { expedition, run, chain, req, challenge, setting, seed, answered } = props;
  const [config, setConfig] = useState<LabConfig>(() => challenge.setup(seed));
  const [open, setOpen] = useState<Stage>(challenge.stage);
  useEffect(() => {
    setConfig(challenge.setup(seed));
    setOpen(challenge.stage);
  }, [challenge, seed]);
  const result = useMemo(() => runLab(config), [config]);
  const met = challenge.goal.met(result);
  const hint = props.misses >= 2 && !answered ? differences(config, challenge.solution(config)) : [];
  const panel = { config, result, onChange: setConfig, disabled: Boolean(answered) };

  return (
    <div className="scene-layout">
      <ExpeditionSide expedition={expedition} run={run} chain={chain} onLeave={props.onLeave} />
      <section className="scene card lab" aria-live="polite">
        <div className="scene-meta">
          <span className="badge">Ch. {req.step.chapter}</span>
          <span className="badge"><PixelIcon name="cpu" /> Lab · {STAGE_LABELS[challenge.stage]}</span>
          <span className="badge">{setting.name}{setting.kind === 'familiar' ? ' (analogy)' : ''}</span>
          {req.confirming && <span className="badge">Confirmation</span>}
        </div>
        <div className="narration"><p>{challenge.brief(setting)}</p></div>
        <p className={met ? 'goal met' : 'goal'}>
          <PixelIcon name="target" /> <strong>Goal:</strong> {challenge.goal.text}
          <span className="small"> Now: {challenge.readout(result)}.</span>
        </p>

        <div className="stages" role="tablist" aria-label="Pipeline stages">
          {(['data', 'train', 'evaluate'] as Stage[]).map((s) => (
            <button key={s} role="tab" aria-selected={open === s} className={open === s ? 'tab active' : 'tab'} onClick={() => setOpen(s)}>
              {STAGE_LABELS[s]}{s === challenge.stage ? ' ·' : ''}
            </button>
          ))}
        </div>
        {open === 'data' && <DataPanel {...panel} />}
        {open === 'train' && <TrainPanel {...panel} />}
        {open === 'evaluate' && <EvaluatePanel {...panel} />}

        {hint.length > 0 && (
          <p className="hint"><PixelIcon name="lightbulb" /> Hint: look at {hint.join(', ')}.</p>
        )}
        {props.canDefer && (
          <div className="defer">
            <p>This link has been tough. You can keep at it, or park it in the rematch queue and move on.</p>
            <button className="ghost" onClick={props.onDefer}>Park it for later</button>
          </div>
        )}

        {!answered && (
          <button className="primary" onClick={() => props.onSubmit(result)}>
            <PixelIcon name={met ? 'check' : 'zap'} /> {met ? 'Submit: the goal is met' : 'Submit as it is'}
          </button>
        )}

        {answered && (
          <div className={answered.correct ? 'result good' : 'result bad'}>
            <p className="result-head">
              {answered.correct ? 'Goal met.' : 'Goal not met.'}{' '}
              <span>{answered.points >= 0 ? '+' : ''}{answered.points} pts</span>
            </p>
            <p><em>Result:</em> {answered.readout}.</p>
            <p className={`gate ${answered.gate.advance ? 'go' : 'hold'}`}>
              <strong>{answered.gate.advance ? 'Next link' : 'Same link'}</strong> — {answered.gate.reason}
            </p>
            <div className="definition">
              {challenge.terms.map((id) => term(id)).filter(Boolean).map((t, i) => (
                <p key={t!.id} className={i === 0 ? '' : 'small'}><strong>{t!.term}</strong> — {t!.definition}</p>
              ))}
            </div>
            <button className="primary" onClick={props.onContinue}>
              {expedition.status === 'complete' ? 'See how it ends' : answered.gate.advance ? 'Onward' : answered.correct ? 'Confirm with a new setup' : 'Try a new setup'}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
