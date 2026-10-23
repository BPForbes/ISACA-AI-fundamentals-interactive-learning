// The project: the run's current round, worked in the lab. The side panel shows
// the five stages and their goals; the main panel shows the current goal's brief
// and target, the lab's panels (the goal's stage open, the others reachable, so
// the learner can go back and change earlier work), and the debrief after a
// submission. When every goal has been worked, the project's report closes it.
import { useEffect, useMemo, useState } from 'react';
import type { Brief } from '../data/briefs';
import { STAGES, type Goal, type Stage } from '../data/goals';
import { TERM_BY_ID } from '../data/terms';
import { runLab, type LabConfig, type LabResult } from '../engine/lab';
import { currentGoal, labForCurrent, reportProject, type ProjectState } from '../engine/project';
import { capabilities, RUN_GOAL, type RunState } from '../engine/run';
import type { GateDecision } from '../engine/tracker';
import { DataPanel, DecidePanel, DefinePanel, DeployPanel, TrainPanel } from './LabPanels';
import { PixelIcon } from './PixelIcon';

export type GoalAnswered = { met: boolean; points: number; gate: GateDecision; readout: string };

type Props = {
  run: RunState;
  project: ProjectState;
  brief: Brief;
  answered: GoalAnswered | null;
  canDefer: boolean;
  onSubmit: (lab: LabConfig, result: LabResult) => void;
  onContinue: () => void;
  onDefer: () => void;
  onFinish: () => void;
  onAbandon: () => void;
};

export const STAGE_LABELS: Record<Stage, string> = { define: 'Define', data: 'Data', train: 'Train', decide: 'Decide', deploy: 'Deploy' };

const term = (id: string) => TERM_BY_ID.get(id);

// Plain names for the controls a hint can point at.
const CONTROL_NAMES: Record<string, string> = {
  capability: 'the capability', paradigm: 'the learning paradigm', scope: 'the scope',
  sampling: 'the sampling method', sampleSize: 'the sample size', cleanse: 'cleansing', verifyLabels: 'the label check', augment: 'augmentation', recent: 'retraining on recent cases',
  scale: 'the feature scale', interaction: 'the interaction feature', normalize: 'standardizing the features',
  depth: 'the hidden layers', hidden: 'the units per layer', learningRate: 'the learning rate', epochs: 'the epochs', batchSize: 'the batch size', l2: 'regularization', momentum: 'momentum',
  approach: 'the approach', rules: 'the rules', capacity: 'the reviewer capacity', band: 'the uncertainty band', showScore: 'whether reviewers see the score',
  threshold: 'the threshold', assessOn: 'which rows are assessed', kpi: 'the KPI',
  monitoring: 'monitoring', retrainOnAlert: 'retraining on alerts', oversight: 'human oversight', auditTrail: 'the audit trail', fairnessTesting: 'fairness testing',
  accessControl: 'access control', backups: 'backups', minimization: 'data minimization', riskAppetite: 'the risk appetite',
};

const differences = (a: LabConfig, b: LabConfig): string[] => {
  const out = new Set<string>();
  const cmp = (x: Record<string, unknown>, y: Record<string, unknown>) => {
    for (const k of Object.keys(y)) if (JSON.stringify(x[k]) !== JSON.stringify(y[k]) && CONTROL_NAMES[k]) out.add(CONTROL_NAMES[k]);
  };
  cmp(a.problem, b.problem);
  cmp(a.data, b.data);
  cmp(a.features, b.features);
  cmp(a.model, b.model);
  cmp(a.review, b.review);
  cmp(a.deploy, b.deploy);
  cmp({ approach: a.approach, rules: a.rules, threshold: a.threshold, assessOn: a.assessOn, kpi: a.kpi }, { approach: b.approach, rules: b.rules, threshold: b.threshold, assessOn: b.assessOn, kpi: b.kpi });
  return [...out];
};

function ProjectSide({ run, project, brief, onAbandon }: { run: RunState; project: ProjectState; brief: Brief; onAbandon: () => void }) {
  const cur = currentGoal(project);
  return (
    <aside className="scene-side card">
      <p className="eyebrow"><PixelIcon name="zap" /> Project {project.round + 1} · {run.roundsCleared}/{RUN_GOAL} cleared</p>
      <h2>{run.codename}</h2>
      <p className="small">A model to {brief.task}, for {brief.owner}.</p>
      <ol className="stages-list">
        {STAGES.map((stage) => (
          <li key={stage} className={cur?.state.stage === stage ? 'current' : ''}>
            <strong>{STAGE_LABELS[stage]}</strong>
            <ul>
              {project.goals.filter((g) => g.stage === stage).map((g, i) => (
                <li key={i} className={`goal-${g.outcome}${project.goals[project.index] === g && project.status === 'active' ? ' now' : ''}`}>
                  <span className="dot" />{term(g.anchor)?.term ?? g.anchor}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <ul className="run-bar" aria-label="Team meters">
        <li><PixelIcon name="heart" /> <strong className="mono">{run.meters.trust}</strong> trust</li>
        <li><PixelIcon name="battery-medium" /> <strong className="mono">{run.meters.budget}</strong> budget</li>
        <li><PixelIcon name="warning-diamond" /> <strong className="mono">{run.meters.risk}</strong> risk</li>
        <li><PixelIcon name="coins" /> <strong className="mono">{run.credits}</strong> credits</li>
      </ul>
      <button className="ghost" onClick={onAbandon} title="The project closes now with the lab as it stands; goals not yet worked count as not met">Close the project now</button>
    </aside>
  );
}

function ProjectEnd({ run, project, brief, onFinish }: { run: RunState; project: ProjectState; brief: Brief; onFinish: () => void }) {
  const report = useMemo(() => reportProject(project), [project]);
  const dr = report.final.deploy;
  return (
    <section className="card end">
      <p className="eyebrow">Project complete</p>
      <h1>{report.cleared ? `${run.codename} delivers` : `${run.codename} falls short`}</h1>
      <p>
        Over six months the model deployed for {brief.owner} produced a value of <strong className="mono">{dr.value}</strong> against a target of <strong className="mono">{dr.kgiTarget}</strong>,
        at a cost of <strong className="mono">{dr.cost}</strong>, with {dr.incidents.length} incident{dr.incidents.length === 1 ? '' : 's'}.
        {' '}{report.goalsMet} of {report.goalsTotal} goals were met.
      </p>
      <div className={report.cleared ? 'report good' : 'report bad'}>
        <strong>{report.cleared ? 'Round cleared.' : 'Round failed.'}</strong>{' '}
        Budget −{report.budgetSpent}{report.cleared ? ' +15 (funding renewed)' : ''}; risk {report.riskGained + (report.cleared ? -5 : 10) >= 0 ? '+' : ''}{report.riskGained + (report.cleared ? -5 : 10)}; trust {report.trustGained + (report.cleared ? 5 : -10) >= 0 ? '+' : ''}{report.trustGained + (report.cleared ? 5 : -10)}.
      </div>
      {dr.incidents.length > 0 && (
        <ul className="incidents">
          {dr.incidents.map((i, k) => <li key={k}><PixelIcon name="warning-diamond" /> Month {i.month}: {i.text}</li>)}
        </ul>
      )}
      <h2>Goals</h2>
      <ol className="recap">
        {project.goals.map((g, i) => (
          <li key={i} className={g.outcome === 'met' ? 'good' : 'bad'}>
            <strong>{term(g.anchor)?.term ?? g.anchor}</strong> ({STAGE_LABELS[g.stage]}) — {g.outcome}{g.attempts > 1 ? ` after ${g.attempts} attempts` : ''}.
          </li>
        ))}
      </ol>
      <button className="primary" onClick={onFinish}>To the workshop</button>
    </section>
  );
}

export function ProjectView(props: Props) {
  const { run, project, brief, answered } = props;
  const cur = currentGoal(project);
  const caps = useMemo(() => capabilities(run), [run]);
  // The lab resets when the goal changes, and when a miss or confirmation re-seeds it.
  const labKey = `${project.id}:${project.index}:${cur?.state.attempts ?? 0}`;
  const [config, setConfig] = useState<LabConfig>(() => labForCurrent(project) ?? project.lab);
  const [open, setOpen] = useState<Stage>(cur?.state.stage ?? 'define');
  useEffect(() => {
    setConfig(labForCurrent(project) ?? project.lab);
    setOpen(currentGoal(project)?.state.stage ?? 'define');
    // The key is what changes; the project itself changes on every submission.
  }, [labKey]);
  const result = useMemo(() => runLab(config), [config]);

  if (project.status === 'complete' || !cur) {
    return (
      <div className="scene-layout">
        <ProjectSide run={run} project={project} brief={brief} onAbandon={props.onAbandon} />
        <ProjectEnd run={run} project={project} brief={brief} onFinish={props.onFinish} />
      </div>
    );
  }

  const goal: Goal = cur.goal;
  const met = goal.goal.met(result);
  const hint = cur.state.misses >= 2 && !answered ? differences(config, goal.solution(config)) : [];
  const panel = { config, result, caps, onChange: setConfig, disabled: Boolean(answered) };

  return (
    <div className="scene-layout">
      <ProjectSide run={run} project={project} brief={brief} onAbandon={props.onAbandon} />
      <section className="scene card lab" aria-live="polite">
        <div className="scene-meta">
          <span className="badge"><PixelIcon name="cpu" /> {STAGE_LABELS[cur.state.stage]} · goal {project.index + 1} of {project.goals.length}</span>
          <span className="badge">Ch. {term(goal.anchor)?.chapter}</span>
          {cur.state.lastCorrect && cur.state.attempts > 0 && !answered && <span className="badge">Confirmation</span>}
        </div>
        <div className="narration"><p>{goal.brief(brief)}</p></div>
        <p className={met ? 'goal met' : 'goal'}>
          <PixelIcon name="target" /> <strong>Goal:</strong> {goal.goal.text}
          <span className="small"> Now: {goal.readout(result)}.</span>
        </p>

        <div className="stages" role="tablist" aria-label="Lifecycle stages">
          {STAGES.map((s) => (
            <button key={s} role="tab" aria-selected={open === s} className={open === s ? 'tab active' : 'tab'} onClick={() => setOpen(s)}>
              {STAGE_LABELS[s]}{s === cur.state.stage ? ' ·' : ''}
            </button>
          ))}
        </div>
        {open === 'define' && <DefinePanel {...panel} />}
        {open === 'data' && <DataPanel {...panel} />}
        {open === 'train' && <TrainPanel {...panel} />}
        {open === 'decide' && <DecidePanel {...panel} />}
        {open === 'deploy' && <DeployPanel {...panel} />}

        {hint.length > 0 && <p className="hint"><PixelIcon name="lightbulb" /> Hint: look at {hint.join(', ')}.</p>}
        {props.canDefer && (
          <div className="defer">
            <p>This goal has been tough. You can keep at it, or park it in the rematch queue and move on.</p>
            <button className="ghost" onClick={props.onDefer}>Park it for later</button>
          </div>
        )}

        {!answered && (
          <button className="primary" onClick={() => props.onSubmit(config, result)}>
            <PixelIcon name={met ? 'check' : 'zap'} /> {met ? 'Submit: the goal is met' : 'Submit as it is'}
          </button>
        )}

        {answered && (
          <div className={answered.met ? 'result good' : 'result bad'}>
            <p className="result-head">
              {answered.met ? 'Goal met.' : 'Goal not met.'}{' '}
              <span>{answered.points >= 0 ? '+' : ''}{answered.points} pts</span>
            </p>
            <p><em>Result:</em> {answered.readout}.</p>
            <p className={`gate ${answered.gate.advance ? 'go' : 'hold'}`}>
              <strong>{answered.gate.advance ? 'Next goal' : 'Same goal'}</strong> — {answered.gate.reason}
            </p>
            <div className="definition">
              {goal.terms.map((id) => term(id)).filter(Boolean).map((t, i) => (
                <p key={t!.id} className={i === 0 ? '' : 'small'}><strong>{t!.term}</strong> — {t!.definition}</p>
              ))}
            </div>
            <button className="primary" onClick={props.onContinue}>
              {answered.gate.advance ? (project.index + 1 >= project.goals.length ? 'See the project through' : 'Onward') : answered.met ? 'Confirm with a new setup' : 'Try a new setup'}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
