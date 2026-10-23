// The lab's five panels, one per stage of the lifecycle. Every control changes
// the lab config; the parent re-runs the lab and passes the result back. Controls
// the run has not unlocked are shown disabled, so what an upgrade would give is
// visible. Terms appear with their definitions in tooltips; nothing here decides
// anything about mastery.
import type { Capability } from '../data/upgrades';
import { TERM_BY_ID } from '../data/terms';
import type { LabConfig, LabResult } from '../engine/lab';
import type { Sampling } from '../engine/lab/dataset';
import { APPETITE_LIMIT, CONTROL_COST, type DeployConfig } from '../engine/lab/deploy';
import { METRIC_IDS, type MetricId } from '../engine/lab/metrics';
import { BATCH_SIZES, HIDDEN_SIZES, L2_STEPS, LEARNING_RATES, MAX_EPOCHS } from '../engine/lab/model';
import { describeRule, induceRule, KNOWLEDGE_BASE, MAX_RULES, ruleStats, type Approach, type Rule } from '../engine/lab/rules';
import { PixelIcon } from './PixelIcon';

export type PanelProps = {
  config: LabConfig;
  result: LabResult;
  caps: Set<Capability>;
  onChange: (c: LabConfig) => void;
  disabled: boolean;
};

const term = (id: string) => TERM_BY_ID.get(id);
export const Term = ({ id, children }: { id: string; children?: string }) => {
  const t = term(id);
  return <span className="term" title={t ? `${t.term}: ${t.definition}` : undefined}>{children ?? t?.term ?? id}</span>;
};
const pct = (v: number) => `${Math.round(v * 100)}%`;

// ---------- drawings ----------

const W = 260;
const H = 200;
const sx = (x: number) => ((x + 1.2) / 2.4) * W;
const sy = (y: number) => H - ((y + 1.2) / 2.4) * H;

export function Scatter({ result, boundary }: { result: LabResult; boundary: boolean }) {
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

export function Curves({ result }: { result: LabResult }) {
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
      <text x={4} y={12} className="net-label">loss (training, validation)</text>
      <text x={W - 4} y={H - 4} className="net-label" textAnchor="end">epoch {curve.length}</text>
    </svg>
  );
}

export function ScoreStrip({ result }: { result: LabResult }) {
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

export function DefinePanel({ config, result, onChange, disabled }: PanelProps) {
  const p = config.problem;
  const set = (patch: Partial<LabConfig['problem']>) => onChange({ ...config, problem: { ...p, ...patch } });
  return (
    <div className="lab-panel">
      <div className="lab-controls wide">
        <fieldset disabled={disabled}>
          <legend><Term id="problem-definition">The problem</Term></legend>
          <label className="field">Capability needed
            <select value={p.capability} onChange={(e) => set({ capability: e.target.value as LabConfig['problem']['capability'] })}>
              <option value="classification">Classification: put each case in a category</option>
              <option value="forecasting">Forecasting: predict next quarter's numbers</option>
              <option value="perception">Perception: read images or sound</option>
              <option value="generation">Generation: create new content</option>
            </select>
          </label>
          <label className="field">Learning paradigm
            <select value={p.paradigm} onChange={(e) => set({ paradigm: e.target.value as LabConfig['problem']['paradigm'] })}>
              <option value="supervised">Supervised: learn from labelled cases</option>
              <option value="unsupervised">Unsupervised: find groupings without labels</option>
              <option value="reinforcement">Reinforcement: learn from rewards</option>
            </select>
          </label>
          <label className="field">Scope
            <select value={p.scope} onChange={(e) => set({ scope: e.target.value as LabConfig['problem']['scope'] })}>
              <option value="narrow">Narrow: this task and nothing else</option>
              <option value="general">General: anything the business might ask</option>
            </select>
          </label>
        </fieldset>
      </div>
      <p className="small">
        {result.problemOk
          ? <><PixelIcon name="check" /> Defined as supervised classification: the labelled cases can train it. Accuracy on validation {pct(result.decided.accuracy)}.</>
          : <><PixelIcon name="warning-diamond" /> As defined, nothing learns from the labelled cases: the model scores every case the same (accuracy {pct(result.decided.accuracy)}).</>}
        {' '}Monthly compute {result.monthlyCompute}{p.scope === 'general' ? ' (a general-scope system is costed as if it had to do everything)' : ''}.
      </p>
    </div>
  );
}

export function DataPanel({ config, result, caps, onChange, disabled }: PanelProps) {
  const d = config.data;
  const set = (patch: Partial<LabConfig['data']>) => onChange({ ...config, data: { ...d, ...patch } });
  const share = result.dataset.groupShare;
  return (
    <div className="lab-panel">
      <Scatter result={result} boundary={false} />
      <div className="lab-controls">
        <fieldset disabled={disabled}>
          <legend><Term id="data-collection">Sample</Term></legend>
          {(['convenience', 'random', 'stratified'] as Sampling[]).map((m) => (
            <label key={m} className="radio">
              <input type="radio" name="sampling" checked={d.sampling === m} onChange={() => set({ sampling: m })} />
              <Term id={m === 'random' ? 'simple-random-sampling' : `${m}-sampling`}>{m === 'random' ? 'Random (probability)' : m === 'convenience' ? 'Convenience' : 'Stratified'}</Term>
            </label>
          ))}
          <label className="field"><span>Sample size: <strong className="mono">{d.sampleSize}</strong></span>
            <input type="range" min={12} max={200} step={4} value={d.sampleSize} onChange={(e) => set({ sampleSize: Number(e.target.value) })} />
          </label>
          <label className="check"><input type="checkbox" checked={d.cleanse} onChange={(e) => set({ cleanse: e.target.checked })} /> <Term id="data-cleansing">Cleanse</Term>: drop duplicates and impossible readings</label>
          <label className="check"><input type="checkbox" checked={d.verifyLabels} onChange={(e) => set({ verifyLabels: e.target.checked })} /> <Term id="provenance">Check labels against their source</Term></label>
          <label className="check" title={caps.has('augment') ? undefined : 'Unlocked by the Data Augmentation upgrade'}>
            <input type="checkbox" checked={d.augment} disabled={!caps.has('augment')} onChange={(e) => set({ augment: e.target.checked })} /> <Term id="data-augmentation">Augment</Term>: add jittered copies{caps.has('augment') ? '' : ' (locked)'}
          </label>
          {d.drift > 0 && <label className="check"><input type="checkbox" checked={d.recent} onChange={(e) => set({ recent: e.target.checked })} /> Retrain on this quarter's cases</label>}
        </fieldset>
      </div>
      <p className="small">
        {result.dataset.sample.length} rows handed over, {result.dataset.train.length} used for training
        {result.dataset.removed ? `, ${result.dataset.removed} removed` : ''}{result.dataset.corrected ? `, ${result.dataset.corrected} labels corrected` : ''}.
        Minority group (squares): {pct(share.sample)} of the sample, {pct(share.population)} of the population.
      </p>
    </div>
  );
}

export function TrainPanel({ config, result, caps, onChange, disabled }: PanelProps) {
  const m = config.model;
  const f = config.features;
  const set = (patch: Partial<LabConfig['model']>) => onChange({ ...config, model: { ...m, ...patch } });
  const setF = (patch: Partial<LabConfig['features']>) => onChange({ ...config, features: { ...f, ...patch } });
  const maxDepth = caps.has('depth2') ? 2 : 1;
  const hiddenOptions = [...new Set([...HIDDEN_SIZES.filter((h) => caps.has('wide') || h <= 8), m.hidden])].sort((a, b) => a - b);
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
            <div className="risk-steps">
              {([0, 1, 2] as const).map((dp) => (
                <button key={dp} className={m.depth === dp ? 'risk active' : 'risk'} disabled={dp > maxDepth && m.depth !== dp} title={dp > maxDepth ? 'Unlocked by the Depth upgrade' : undefined} onClick={() => set({ depth: dp })}>{dp}</button>
              ))}
            </div>
          </div>
          <label className="field"><Term id="width">Units per hidden layer</Term>
            <select value={m.hidden} onChange={(e) => set({ hidden: Number(e.target.value) })}>{hiddenOptions.map((h) => <option key={h} value={h}>{h}{h > 8 && !caps.has('wide') ? ' (as set)' : ''}</option>)}</select>
          </label>
          <label className="field"><Term id="learning-rate">Learning rate</Term>
            <select value={m.learningRate} onChange={(e) => set({ learningRate: Number(e.target.value) })}>{[...new Set([...LEARNING_RATES, m.learningRate])].sort((a, b) => a - b).map((r) => <option key={r} value={r}>{r}</option>)}</select>
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
          <label className="check" title={caps.has('momentum') ? undefined : 'Unlocked by the Optimizer upgrade'}>
            <input type="checkbox" checked={m.momentum > 0} disabled={!caps.has('momentum')} onChange={(e) => set({ momentum: e.target.checked ? 0.9 : 0 })} /> <Term id="optimizer">Momentum</Term> (0.9){caps.has('momentum') ? '' : ' (locked)'}
          </label>
        </fieldset>
        <fieldset disabled={disabled}>
          <legend><Term id="feature">Features</Term></legend>
          <label className="check"><input type="checkbox" checked={f.normalize} onChange={(e) => setF({ normalize: e.target.checked })} /> <Term id="normalization-data">Standardize</Term> the features{f.scale !== 1 ? ` (x arrives ×${f.scale})` : ''}</label>
          <label className="check" title={caps.has('interaction') ? undefined : 'Unlocked by the Feature Engineering upgrade'}>
            <input type="checkbox" checked={f.interaction} disabled={!caps.has('interaction')} onChange={(e) => setF({ interaction: e.target.checked })} /> <Term id="feature-engineering">Add the interaction</Term> x·y{caps.has('interaction') ? '' : ' (locked)'}
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

const APPROACHES: { id: Approach; label: string; term: string }[] = [
  { id: 'rules', label: 'Rules (symbolic)', term: 'rule-based' },
  { id: 'ml', label: 'The model (statistical)', term: 'ml-approach' },
  { id: 'hybrid', label: 'Hybrid: rules first, then the model', term: 'hybrid-ai' },
];

export function DecidePanel({ config, result, caps, onChange, disabled }: PanelProps) {
  const rules = config.rules;
  const stats = ruleStats(rules, result.dataset.validation);
  const setRules = (next: Rule[]) => onChange({ ...config, rules: next.slice(0, MAX_RULES) });
  const review = config.review;
  const setReview = (patch: Partial<LabConfig['review']>) => onChange({ ...config, review: { ...review, ...patch } });
  const maxReview = caps.has('review60') ? 60 : 30;
  const m = result.metrics;
  const d = result.decided;
  const move = (i: number, dir: -1 | 1) => {
    const next = [...rules];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setRules(next);
  };
  const induced = induceRule(result.dataset.train, rules);
  return (
    <div className="lab-panel split">
      <div className="lab-main">
        <fieldset disabled={disabled} className="approach">
          <legend><Term id="hybrid-ai">Approach</Term></legend>
          {APPROACHES.map((a) => (
            <label key={a.id} className="radio"><input type="radio" name="approach" checked={config.approach === a.id} onChange={() => onChange({ ...config, approach: a.id })} /> <Term id={a.term}>{a.label}</Term></label>
          ))}
        </fieldset>
        <fieldset disabled={disabled} className="rules">
          <legend><Term id="knowledge-base">Rules</Term> ({rules.length}/{MAX_RULES}), applied in order by the <Term id="inference-engine">inference engine</Term></legend>
          {rules.length === 0 && <p className="small">No rules yet. Cases no rule decides go to a reviewer if there is capacity, else default to negative.</p>}
          <ol className="rule-list">
            {rules.map((r, i) => (
              <li key={i}>
                <span>{describeRule(r)}{r.induced ? ' (induced)' : ''}</span>
                <span className="small mono">{stats[i].covered} decided, {stats[i].covered ? pct(stats[i].correct / stats[i].covered) : '–'} right</span>
                <span className="rule-actions">
                  <button className="ghost" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                  <button className="ghost" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === rules.length - 1}>↓</button>
                  <button className="ghost" aria-label="Remove" onClick={() => setRules(rules.filter((_, k) => k !== i))}>×</button>
                </span>
              </li>
            ))}
          </ol>
          <div className="rule-sources">
            <span className="small"><Term id="deductive">From the knowledge base</Term>:</span>
            {KNOWLEDGE_BASE.map((k, i) => (
              <button key={i} className="ghost" title={k.fact} disabled={rules.length >= MAX_RULES || rules.some((r) => describeRule(r) === describeRule(k.rule))} onClick={() => setRules([...rules, k.rule])}>
                + {describeRule(k.rule)}
              </button>
            ))}
            <span className="small"><Term id="inductive">From the data</Term>:</span>
            <button className="ghost" disabled={!induced || rules.length >= MAX_RULES} onClick={() => induced && setRules([...rules, induced])}>
              + Induce a rule{induced ? `: ${describeRule(induced)}` : ''}
            </button>
            <button className="ghost" disabled={rules.length >= MAX_RULES} onClick={() => setRules([...rules, { feature: 'x', op: '>', value: -3, outcome: 1 }])}>+ Catch-all: everything else → positive</button>
          </div>
        </fieldset>
        <fieldset disabled={disabled}>
          <legend><Term id="hitl">Review</Term></legend>
          <label className="field"><span>Reviewer capacity: <strong className="mono">{review.capacity}</strong> cases in a hundred{caps.has('review60') ? '' : ' (up to 30; more with the Human Oversight upgrade)'}</span>
            <input type="range" min={0} max={maxReview} step={5} value={Math.min(review.capacity, maxReview)} onChange={(e) => setReview({ capacity: Number(e.target.value) })} />
          </label>
          <label className="field"><span>Uncertainty band around the threshold: <strong className="mono">{review.band.toFixed(2)}</strong></span>
            <input type="range" min={0} max={1} step={0.1} value={review.band} onChange={(e) => setReview({ band: Number(e.target.value) })} />
          </label>
          <label className="check"><input type="checkbox" checked={review.showScore} onChange={(e) => setReview({ showScore: e.target.checked })} /> Show reviewers the model's score (<Term id="automation-bias">automation bias</Term>)</label>
        </fieldset>
        <fieldset disabled={disabled}>
          <legend>Threshold and KPI</legend>
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
      <div className="lab-side">
        <p className="small"><strong>Decisions on the 100 validation cases:</strong> accuracy <strong className="mono">{pct(d.accuracy)}</strong>; {pct(d.explained)} explainable
          ({d.bySource.rule} by rule, {d.bySource.human} by a reviewer, {d.bySource.model} by the model, {d.bySource.default} by default).
          {d.bySource.human > 0 && <> Reviewers {pct(d.reviewerAccuracy)} right.</>} Minority group {pct(d.minorityAccuracy)}.</p>
        <ScoreStrip result={result} />
        <table className="confusion" aria-label="Confusion matrix of the model's scores at the threshold">
          <thead><tr><th /><th>Predicted +</th><th>Predicted −</th></tr></thead>
          <tbody>
            <tr><th>Actual +</th><td><Term id="tp">TP</Term> <strong className="mono">{m.tp}</strong></td><td><Term id="fn">FN</Term> <strong className="mono">{m.fn}</strong></td></tr>
            <tr><th>Actual −</th><td><Term id="fp">FP</Term> <strong className="mono">{m.fp}</strong></td><td><Term id="tn">TN</Term> <strong className="mono">{m.tn}</strong></td></tr>
          </tbody>
        </table>
        <ul className="metrics">
          {METRIC_IDS.map((id) => <li key={id} className={config.kpi === id ? 'kpi' : ''}><Term id={id} /> <strong className="mono">{pct(m[id])}</strong></li>)}
          <li><Term id="fairness-testing">Group accuracy</Term> <strong className="mono">{pct(result.groups.majority)} / {pct(result.groups.minority)}</strong></li>
        </ul>
      </div>
    </div>
  );
}

const CONTROLS: { key: keyof Omit<DeployConfig, 'riskAppetite'>; label: string; term: string; free?: Capability }[] = [
  { key: 'monitoring', label: 'Monitor the model (drift alerts)', term: 'monitoring', free: 'freeMonitoring' },
  { key: 'retrainOnAlert', label: 'Retrain on an alert', term: 'model-drift' },
  { key: 'oversight', label: 'Human oversight of costly calls', term: 'human-oversight' },
  { key: 'auditTrail', label: 'Keep an audit trail', term: 'audit-trail', free: 'freeAudit' },
  { key: 'fairnessTesting', label: 'Fairness testing before launch', term: 'fairness-testing', free: 'freeFairness' },
  { key: 'accessControl', label: 'Access control on the case store', term: 'least-privilege' },
  { key: 'backups', label: 'Backups', term: 'backup', free: 'freeBackups' },
  { key: 'minimization', label: 'Keep only the fields the purpose needs', term: 'data-minimization' },
];

export function DeployPanel({ config, result, caps, onChange, disabled }: PanelProps) {
  const dc = config.deploy;
  const set = (patch: Partial<DeployConfig>) => onChange({ ...config, deploy: { ...dc, ...patch } });
  const dr = result.deploy;
  return (
    <div className="lab-panel split">
      <div className="lab-main">
        <fieldset disabled={disabled}>
          <legend><Term id="control">Controls</Term> (cost a month)</legend>
          {CONTROLS.map((c) => {
            const free = c.free ? caps.has(c.free) : false;
            return (
              <label key={c.key} className="check">
                <input type="checkbox" checked={dc[c.key]} onChange={(e) => set({ [c.key]: e.target.checked })} />
                <Term id={c.term}>{c.label}</Term> <span className="small mono">{free ? 'free' : CONTROL_COST[c.key]}</span>
              </label>
            );
          })}
          <label className="field"><Term id="risk-appetite">Risk appetite</Term>
            <select value={dc.riskAppetite} onChange={(e) => set({ riskAppetite: e.target.value as DeployConfig['riskAppetite'] })}>
              {(['low', 'medium', 'high'] as const).map((a) => <option key={a} value={a}>{a}: at most {APPETITE_LIMIT[a]} incident{APPETITE_LIMIT[a] === 1 ? '' : 's'}</option>)}
            </select>
          </label>
        </fieldset>
      </div>
      <div className="lab-side">
        <table className="months" aria-label="Six months of deployment">
          <thead><tr><th>Month</th><th>Accuracy</th><th>Alert</th><th>Value</th><th>Cost</th><th>Incidents</th></tr></thead>
          <tbody>
            {dr.months.map((mo) => (
              <tr key={mo.month}>
                <td className="mono">{mo.month}</td>
                <td className="mono">{pct(mo.accuracy)}</td>
                <td>{mo.alert ? (mo.retrained ? 'alert, retrained' : 'alert') : ''}</td>
                <td className="mono">{mo.value}</td>
                <td className="mono">{mo.cost}</td>
                <td>{mo.incidents.map((i) => i.kind).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small">
          <strong>Six months:</strong> value <strong className="mono">{dr.value}</strong> against a <Term id="kgi">KGI</Term> target of <strong className="mono">{dr.kgiTarget}</strong>
          {' '}({dr.kgiMet ? 'met' : 'not met'}); cost <strong className="mono">{dr.cost}</strong> (<Term id="tco">TCO</Term>); <Term id="roi">return</Term> <strong className="mono">{Math.round(dr.roi * 100)}%</strong>;
          {' '}{dr.incidents.length} incident{dr.incidents.length === 1 ? '' : 's'}, {dr.withinAppetite ? 'within' : 'beyond'} the appetite.
        </p>
        {dr.incidents.length > 0 && (
          <ul className="incidents">
            {dr.incidents.map((i, k) => <li key={k}><PixelIcon name="warning-diamond" /> Month {i.month}, <Term id={`${i.kind}-risk`}>{i.kind}</Term>: {i.text}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}
