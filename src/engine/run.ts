// The roguelike run: one attempt to build and ship a model for a brief. Each
// round is a project, worked in the lab across the lifecycle's five stages, and
// cleared when the model as deployed meets the brief's business goal over six
// simulated months. Between rounds the workshop sells upgrades, drawn from the
// term bank, that give the lab capabilities. The team meters carry over from
// round to round, and the run ends when the budget is spent, governance halts
// training, or enough rounds are cleared.
//
// The run reads the project's outcome and nothing else. It never changes which
// concept is asked, whether a goal counts, mastery, or the move-on gate.

import { BRIEFS, codename, type Brief } from '../data/briefs';
import { capabilitiesOf, UPGRADE_BY_ID, UPGRADES, type Capability } from '../data/upgrades';
import type { Meters } from './director';
import { seededRng } from './lstm';
import type { ProjectReport, ProjectState } from './project';

// Rounds cleared to ship the model and win the run.
export const RUN_GOAL = 6;
export const START_CREDITS = 1;
export const OFFER_SIZE = 3;
export const START_METERS: Meters = { trust: 60, budget: 70, risk: 30 };

export type RunPhase = 'workshop' | 'project' | 'over';
export type RunEnding = 'shipped' | 'defunded' | 'halted';

export type RoundReport = {
  cleared: boolean;
  goalsMet: number;
  goalsTotal: number;
  value: number;
  kgiTarget: number;
  incidents: number;
  creditsEarned: number;
  metersBefore: Meters;
  metersAfter: Meters;
};

export type RunState = {
  id: string;
  briefId: string;
  codename: string;
  startedAt: string;
  seed: number;
  phase: RunPhase;
  upgrades: Record<string, number>;
  credits: number;
  roundsCleared: number;
  roundsFailed: number;
  // Carried from round to round.
  meters: Meters;
  // The workshop's current draft of upgrade ids.
  offer: string[];
  project: ProjectState | null;
  // The last round's result, shown in the workshop.
  lastReport: RoundReport | null;
  ending: RunEnding | null;
};

const clamp = (n: number) => Math.max(0, Math.min(100, n));

const rngFor = (run: Pick<RunState, 'seed' | 'roundsCleared' | 'roundsFailed'>) =>
  seededRng(run.seed + 7919 * (run.roundsCleared + run.roundsFailed + 1));

/** The workshop's draft: upgrades not yet owned, picked from the run's own stream. */
export const draftOffer = (run: Pick<RunState, 'seed' | 'roundsCleared' | 'roundsFailed' | 'upgrades'>): string[] => {
  const rng = rngFor(run);
  const pool = UPGRADES.filter((u) => !(run.upgrades[u.id] ?? 0)).map((u) => u.id);
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, OFFER_SIZE);
};

export const newRun = (now: string, id: string, seed: number, briefId?: string): RunState => {
  const rng = seededRng(seed);
  const brief: Brief = (briefId && BRIEFS.find((b) => b.id === briefId)) || BRIEFS[Math.floor(rng() * BRIEFS.length)];
  const run: RunState = {
    id,
    briefId: brief.id,
    codename: codename(rng),
    startedAt: now,
    seed,
    phase: 'workshop',
    upgrades: {},
    credits: START_CREDITS,
    roundsCleared: 0,
    roundsFailed: 0,
    meters: { ...START_METERS },
    offer: [],
    project: null,
    lastReport: null,
    ending: null,
  };
  return { ...run, offer: draftOffer(run) };
};

export const capabilities = (run: RunState): Set<Capability> => capabilitiesOf(run.upgrades);

export const canBuy = (run: RunState, id: string): boolean => {
  const u = UPGRADE_BY_ID.get(id);
  return Boolean(u) && run.phase === 'workshop' && run.offer.includes(id) && run.credits >= u!.cost && !(run.upgrades[id] ?? 0);
};

/** Buys an offered upgrade; the offer slot is spent. */
export const buyUpgrade = (run: RunState, id: string): RunState => {
  if (!canBuy(run, id)) return run;
  const u = UPGRADE_BY_ID.get(id)!;
  return { ...run, credits: run.credits - u.cost, upgrades: { ...run.upgrades, [id]: 1 }, offer: run.offer.filter((o) => o !== id) };
};

export const beginProject = (run: RunState, project: ProjectState): RunState =>
  run.phase === 'workshop' ? { ...run, phase: 'project', project } : run;

/**
 * Closes the round with the project's report. A cleared round earns credits and
 * funding; a failed one brings a governance review. The deployment's incidents
 * and costs land on the meters either way. Then the run ends, or the workshop
 * opens with a new draft.
 */
export const finishProject = (run: RunState, report: ProjectReport): RunState => {
  if (run.phase !== 'project') return run;
  const cleared = report.cleared;
  const allMet = report.goalsMet === report.goalsTotal;
  const creditsEarned = cleared ? 2 + (allMet ? 1 : 0) : report.goalsMet >= report.goalsTotal / 2 ? 1 : 0;
  const m = run.meters;
  const meters: Meters = {
    trust: clamp(m.trust + report.trustGained + (cleared ? 5 : -10)),
    budget: clamp(m.budget - report.budgetSpent + (cleared ? 15 : 0)),
    risk: clamp(m.risk + report.riskGained + (cleared ? -5 : 10)),
  };
  const roundsCleared = run.roundsCleared + (cleared ? 1 : 0);
  const roundsFailed = run.roundsFailed + (cleared ? 0 : 1);
  const ending: RunEnding | null = roundsCleared >= RUN_GOAL ? 'shipped' : meters.budget <= 0 ? 'defunded' : meters.risk >= 100 ? 'halted' : null;
  const next: RunState = {
    ...run,
    phase: ending ? 'over' : 'workshop',
    credits: run.credits + creditsEarned,
    roundsCleared,
    roundsFailed,
    meters,
    project: null,
    lastReport: {
      cleared,
      goalsMet: report.goalsMet,
      goalsTotal: report.goalsTotal,
      value: report.final.deploy.value,
      kgiTarget: report.final.deploy.kgiTarget,
      incidents: report.final.deploy.incidents.length,
      creditsEarned,
      metersBefore: run.meters,
      metersAfter: meters,
    },
    ending,
  };
  return { ...next, offer: ending ? [] : draftOffer(next) };
};

export const ENDINGS: Record<RunEnding, { title: string; text: string }> = {
  shipped: { title: 'The model ships', text: 'Six projects cleared. The team hands over a model with its data, its decisions, its controls and its results documented.' },
  defunded: { title: 'Project defunded', text: 'The compute budget ran dry before the model was ready. The lessons stay with you; the model does not.' },
  halted: { title: 'Halted by governance', text: 'Risk exposure reached the board’s limit and the programme was stopped. Mastery you earned on the way is kept.' },
};
