// A project is one round of the run: a sequence of lab goals across the five
// stages of the lifecycle, chosen for what the learner is weakest on, worked in
// one lab whose state carries from goal to goal and stage to stage. The round
// is cleared when the model, as finally deployed, meets the brief's business
// goal over six simulated months. The project decides nothing about mastery:
// each goal's outcome is recorded by the store like any answer, and the
// move-on gate decides whether a met goal is confirmed or the project moves on,
// which it does when the learner leaves the debrief.

import { GOALS, STAGES, type Goal, type Stage } from '../data/goals';
import type { Capability } from '../data/upgrades';
import { defaultLab, runLab, type LabConfig, type LabResult } from './lab';
import { CONTROL_KEYS, type ControlKey, type Pricing } from './lab/deploy';
import { seededRng } from './lstm';

export type ProjectGoal = {
  anchor: string;
  stage: Stage;
  seed: number;
  outcome: 'pending' | 'met' | 'missed' | 'deferred';
  attempts: number;
  misses: number;
  confirmations: number;
  lastCorrect: boolean;
};

export type ProjectState = {
  id: string;
  round: number;
  seed: number;
  goals: ProjectGoal[];
  index: number;
  // The lab as the learner last submitted it; the next goal's setup patches it.
  lab: LabConfig;
  // Lab submissions made, which cost compute.
  submissions: number;
  // The gate said to move on; the project does when the learner leaves the debrief.
  advanceDue: boolean;
  status: 'active' | 'complete';
};

export const GOALS_PER_STAGE: Record<Stage, number> = { define: 1, data: 1, train: 2, decide: 2, deploy: 2 };

// How the deployed world hardens round by round.
export const worldFor = (round: number): LabConfig['world'] => ({
  driftPerMonth: Math.min(0.35, 0.2 + 0.03 * round),
  kgiTarget: 800 + 40 * round,
});

export type Priority = (anchor: string) => number;

// The deployment control each upgrade makes free.
const FREE_CONTROL: Partial<Record<Capability, ControlKey>> = { freeMonitoring: 'monitoring', freeAudit: 'auditTrail', freeFairness: 'fairnessTesting', freeBackups: 'backups' };

/** What the run's upgrades have done to the lab's running costs. */
export const pricingFor = (capabilities: Set<Capability>): Pricing => ({
  compute: capabilities.has('cheapCompute') ? 0.5 : 1,
  free: CONTROL_KEYS.filter((k) => [...capabilities].some((c) => FREE_CONTROL[c] === k)),
});

/**
 * Plans a project: for each stage, the goals the run can pose (its capabilities
 * allow the fix), weakest concept first, ties broken by the project's own stream.
 */
export const planProject = (opts: { id: string; round: number; seed: number; capabilities: Set<Capability>; priority: Priority }): ProjectState => {
  const rng = seededRng(opts.seed);
  const goals: ProjectGoal[] = [];
  for (const stage of STAGES) {
    const pool = GOALS.filter((g) => g.stage === stage && (g.needs ?? []).every((c) => opts.capabilities.has(c)))
      .map((g) => ({ g, key: opts.priority(g.anchor) + rng() * 0.01 }))
      .sort((a, b) => b.key - a.key)
      .slice(0, GOALS_PER_STAGE[stage]);
    for (const { g } of pool) {
      goals.push({ anchor: g.anchor, stage, seed: Math.floor(rng() * 1e9), outcome: 'pending', attempts: 0, misses: 0, confirmations: 0, lastCorrect: false });
    }
  }
  const lab = { ...defaultLab(opts.seed), world: worldFor(opts.round), pricing: pricingFor(opts.capabilities) };
  return { id: opts.id, round: opts.round, seed: opts.seed, goals, index: 0, lab, submissions: 0, advanceDue: false, status: 'active' };
};

export const currentGoal = (p: ProjectState): { goal: Goal; state: ProjectGoal } | null => {
  const state = p.goals[p.index];
  if (!state || p.status !== 'active') return null;
  const goal = GOALS.find((g) => g.anchor === state.anchor);
  return goal ? { goal, state } : null;
};

/** The lab the learner starts the current goal from: the carried lab with the goal's problem applied. */
export const labForCurrent = (p: ProjectState): LabConfig | null => {
  const cur = currentGoal(p);
  return cur ? cur.goal.setup(p.lab, cur.state.seed + cur.state.attempts) : null;
};

/** Records a submission on the current goal; the lab submitted is carried forward. */
export const recordSubmission = (p: ProjectState, lab: LabConfig, met: boolean): ProjectState => {
  const cur = currentGoal(p);
  if (!cur) return p;
  const goals = p.goals.map((g, i) => (i === p.index
    ? { ...g, attempts: g.attempts + 1, misses: g.misses + (met ? 0 : 1), confirmations: g.confirmations + (met && g.lastCorrect ? 1 : 0), lastCorrect: met, outcome: (met ? 'met' : 'missed') as ProjectGoal['outcome'] }
    : g));
  return { ...p, goals, lab, submissions: p.submissions + 1 };
};

/** Moves to the next goal; after the last one the project is complete. */
export const advance = (p: ProjectState): ProjectState => {
  const index = p.index + 1;
  return index >= p.goals.length ? { ...p, index: p.goals.length - 1, status: 'complete', advanceDue: false } : { ...p, index, advanceDue: false };
};

/** Parks the current goal (the learner is stuck) and moves on. */
export const defer = (p: ProjectState): ProjectState =>
  advance({ ...p, goals: p.goals.map((g, i) => (i === p.index ? { ...g, outcome: 'deferred' } : g)) });

export type ProjectReport = {
  cleared: boolean;
  goalsMet: number;
  goalsTotal: number;
  final: LabResult;
  // What the round cost the team and what the deployment did to risk and trust.
  budgetSpent: number;
  riskGained: number;
  trustGained: number;
};

export const COMPUTE_PER_SUBMISSION = 1;

/** The round's result from the lab as finally submitted: cleared when the deployment meets its business goal. */
export const reportProject = (p: ProjectState): ProjectReport => {
  const final = runLab(p.lab);
  const goalsMet = p.goals.filter((g) => g.outcome === 'met').length;
  return {
    cleared: final.deploy.kgiMet,
    goalsMet,
    goalsTotal: p.goals.length,
    final,
    budgetSpent: Math.round(final.deploy.cost / 20) + p.submissions * COMPUTE_PER_SUBMISSION,
    riskGained: final.deploy.incidents.reduce((s, i) => s + i.risk, 0),
    trustGained: final.deploy.incidents.reduce((s, i) => s + i.trust, 0) + (final.deploy.kgiMet ? 10 : -5),
  };
};

export const stageOf = (p: ProjectState): Stage => p.goals[p.index]?.stage ?? 'define';
