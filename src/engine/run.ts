// The roguelike run around the expeditions. A run is one attempt to train a model
// for a brief: each round is one expedition, and every scene answered in it is a
// training step that moves the model's loss. The round's goal is to bring the
// loss under a target by the time the chain completes. Between rounds the
// workshop sells upgrades, drawn from the term bank, that change how training
// behaves. The team meters carry over from round to round, and the run ends when
// the budget is spent, governance halts training, or enough rounds are cleared.
//
// The run reads the outcome of each answer and nothing else. It never changes
// which concept is asked, whether an answer counts, mastery, or the move-on gate.

import { BRIEFS, codename, type Brief } from '../data/briefs';
import { CHAIN_BY_ID } from '../data/chains';
import { UPGRADE_BY_ID, UPGRADES } from '../data/upgrades';
import type { Meters } from './director';
import { seededRng } from './lstm';

export const START_LOSS = 1;
export const BASE_LEARNING_RATE = 0.22;
export const BASE_MISS_PENALTY = 0.18;
export const BASE_LOSS_CAP = 1.5;
// Rounds cleared to ship the model and win the run.
export const RUN_GOAL = 6;
export const START_CREDITS = 1;
export const OFFER_SIZE = 3;

export type RunEffects = {
  learningRate: number;
  missPenalty: number;
  lossCap: number;
  startLoss: number;
  // Extra learning rate per consecutive correct answer in the round.
  momentum: number;
  firstStepTwice: boolean;
  recoverOnFix: boolean;
  augmentFirstMiss: boolean;
  hiddenLayers: number;
  missTrust: number;
  missBudget: number;
  missRisk: number;
  correctBudget: number;
  failedRoundRisk: number;
};

export const baseEffects = (): RunEffects => ({
  learningRate: BASE_LEARNING_RATE,
  missPenalty: BASE_MISS_PENALTY,
  lossCap: BASE_LOSS_CAP,
  startLoss: START_LOSS,
  momentum: 0,
  firstStepTwice: false,
  recoverOnFix: false,
  augmentFirstMiss: false,
  hiddenLayers: 1,
  missTrust: 10,
  missBudget: 8,
  missRisk: 10,
  correctBudget: 2,
  failedRoundRisk: 15,
});

/** The run's numbers with every owned upgrade applied, each at its tier. */
export const effectsOf = (upgrades: Record<string, number>): RunEffects => {
  const fx = baseEffects();
  for (const [id, tier] of Object.entries(upgrades)) {
    const u = UPGRADE_BY_ID.get(id);
    if (u && tier > 0) u.apply(fx, Math.min(tier, u.maxTier));
  }
  return fx;
};

export type TrainingStep = { correct: boolean; loss: number };

export type RoundState = {
  chainId: string;
  target: number;
  loss: number;
  steps: TrainingStep[];
  // Consecutive correct answers so far in this round.
  streak: number;
  misses: number;
  // The loss the last miss added, so attention can undo it.
  lastPenalty: number;
};

export type RunPhase = 'workshop' | 'training' | 'over';
export type RunEnding = 'shipped' | 'defunded' | 'halted';

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
  // Carried from round to round; a new expedition starts with them.
  meters: Meters;
  // The workshop's current draft of upgrade ids.
  offer: string[];
  round: RoundState | null;
  // The last round's result, shown in the workshop.
  lastReport: RoundReport | null;
  ending: RunEnding | null;
};

export type RoundReport = {
  chainId: string;
  cleared: boolean;
  loss: number;
  target: number;
  misses: number;
  creditsEarned: number;
  metersBefore: Meters;
  metersAfter: Meters;
};

export const START_METERS: Meters = { trust: 60, budget: 70, risk: 30 };

/**
 * The loss a round must get under: what a bare network reaches with every link of
 * the chain answered right, with slack that shrinks as rounds are cleared. The
 * first round forgives an early miss; by the last, upgrades are needed.
 */
export const roundTarget = (roundsCleared: number, steps: number): number => {
  const clean = (1 - BASE_LEARNING_RATE) ** steps;
  const slack = Math.max(0.6, 1.25 - 0.08 * roundsCleared);
  return Math.round(clean * slack * 100) / 100;
};

const clamp = (n: number) => Math.max(0, Math.min(100, n));
const round3 = (n: number) => Math.round(n * 1000) / 1000;

const rngFor = (run: Pick<RunState, 'seed' | 'roundsCleared' | 'roundsFailed'>) =>
  seededRng(run.seed + 7919 * (run.roundsCleared + run.roundsFailed + 1));

/** The workshop's draft: upgrades not yet at their top tier, picked from the run's own stream. */
export const draftOffer = (run: Pick<RunState, 'seed' | 'roundsCleared' | 'roundsFailed' | 'upgrades'>): string[] => {
  const rng = rngFor(run);
  const pool = UPGRADES.filter((u) => (run.upgrades[u.id] ?? 0) < u.maxTier).map((u) => u.id);
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
    round: null,
    lastReport: null,
    ending: null,
  };
  return { ...run, offer: draftOffer(run) };
};

export const canBuy = (run: RunState, id: string): boolean => {
  const u = UPGRADE_BY_ID.get(id);
  return Boolean(u) && run.phase === 'workshop' && run.offer.includes(id) && run.credits >= u!.cost && (run.upgrades[id] ?? 0) < u!.maxTier;
};

/** Buys one tier of an offered upgrade; the offer slot is spent. */
export const buyUpgrade = (run: RunState, id: string): RunState => {
  if (!canBuy(run, id)) return run;
  const u = UPGRADE_BY_ID.get(id)!;
  return {
    ...run,
    credits: run.credits - u.cost,
    upgrades: { ...run.upgrades, [id]: (run.upgrades[id] ?? 0) + 1 },
    offer: run.offer.filter((o) => o !== id),
  };
};

export const beginRound = (run: RunState, chainId: string): RunState => {
  if (run.phase !== 'workshop') return run;
  const fx = effectsOf(run.upgrades);
  const steps = CHAIN_BY_ID.get(chainId)?.steps.length ?? 5;
  return {
    ...run,
    phase: 'training',
    round: { chainId, target: roundTarget(run.roundsCleared, steps), loss: fx.startLoss, steps: [], streak: 0, misses: 0, lastPenalty: 0 },
  };
};

export type StepInput = {
  correct: boolean;
  // The previous answer on this link was a miss (the learner is fixing it).
  fixingMiss: boolean;
};

/** One training step: the loss moves by the run's numbers. */
export const trainingStep = (run: RunState, input: StepInput): RunState => {
  const r = run.round;
  if (!r || run.phase !== 'training') return run;
  const fx = effectsOf(run.upgrades);
  let loss = r.loss;
  let lastPenalty = r.lastPenalty;
  let streak = r.streak;
  let misses = r.misses;
  if (input.correct) {
    let rate = fx.learningRate + fx.momentum * streak;
    if (fx.firstStepTwice && r.steps.length === 0) rate = 1 - (1 - rate) ** 2;
    if (fx.recoverOnFix && input.fixingMiss && lastPenalty > 0) loss -= lastPenalty;
    loss *= 1 - Math.min(0.95, rate);
    lastPenalty = 0;
    streak += 1;
  } else {
    const penalty = fx.augmentFirstMiss && misses === 0 ? fx.missPenalty / 2 : fx.missPenalty;
    const capped = Math.min(fx.lossCap, loss + penalty);
    lastPenalty = capped - loss;
    loss = capped;
    streak = 0;
    misses += 1;
  }
  loss = round3(Math.max(0, loss));
  return { ...run, round: { ...r, loss, lastPenalty, streak, misses, steps: [...r.steps, { correct: input.correct, loss }] } };
};

/** How many correct answers in a row would bring the loss under the target from here. */
export const stepsToTarget = (run: RunState): number | null => {
  const r = run.round;
  if (!r) return null;
  const fx = effectsOf(run.upgrades);
  let loss = r.loss;
  let streak = r.streak;
  for (let n = 0; n < 30; n += 1) {
    if (loss <= r.target) return n;
    loss *= 1 - Math.min(0.95, fx.learningRate + fx.momentum * streak);
    streak += 1;
  }
  return null;
};

export const goalMet = (round: RoundState): boolean => round.loss <= round.target;

/**
 * Closes the round with the expedition's final meters. A cleared round earns
 * credits and funding; a failed or abandoned one costs budget and brings a
 * governance review. Then the run ends, or the workshop opens with a new draft.
 */
export const finishRound = (run: RunState, expeditionMeters: Meters, opts: { abandoned?: boolean } = {}): RunState => {
  const r = run.round;
  if (!r || run.phase !== 'training') return run;
  const fx = effectsOf(run.upgrades);
  const cleared = !opts.abandoned && goalMet(r);
  const creditsEarned = cleared ? 2 + (r.misses === 0 ? 1 : 0) : 0;
  const m = expeditionMeters;
  const meters: Meters = cleared
    ? { trust: clamp(m.trust + 5), budget: clamp(m.budget + 10), risk: m.risk }
    : { trust: clamp(m.trust - 10), budget: clamp(m.budget - 15), risk: clamp(m.risk + fx.failedRoundRisk) };
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
    round: null,
    lastReport: { chainId: r.chainId, cleared, loss: r.loss, target: r.target, misses: r.misses, creditsEarned, metersBefore: run.meters, metersAfter: meters },
    ending,
  };
  return { ...next, offer: ending ? [] : draftOffer(next) };
};

export const ENDINGS: Record<RunEnding, { title: string; text: string }> = {
  shipped: { title: 'The model ships', text: 'Six training rounds cleared. The team hands over a model with its metrics, owners and controls documented.' },
  defunded: { title: 'Project defunded', text: 'The compute budget ran dry before the model was ready. The lessons stay with you; the model does not.' },
  halted: { title: 'Halted by governance', text: 'Risk exposure reached the board’s limit and training was stopped. Mastery you earned on the way is kept.' },
};
