// Attention tracker: the attention step of a transformer applied to the answer
// history. To estimate a concept it attends over every earlier answer, with two
// biases instead of learned query and key projections:
//   orthogonal reasoning  the key is the relation table (relations.ts). An answer on a
//                         related concept counts in proportion to rel^sharpness; an
//                         answer on an orthogonal concept (rel = 0) is masked out.
//   temporal reasoning    each answer's weight halves every `halfLifeHours`, so
//                         mastery that has not been used for a while fades.
// The result is a mastery matrix: one estimate per concept, kept in the session and
// recomputed after every answer. Only the two biases are fitted (by grid search), and,
// like the LSTM, the fitted biases are used only while they beat the plain per-concept
// baseline on held-out answers. Until then the baseline is the matrix. Neither ever
// overrides the mastery rules in progress.ts.

import { CONCEPTS, CONCEPT_INDEX, relationTable } from './relations';
import { MIN_HOLDOUT_TARGETS, MIN_TRAIN_TARGETS, TRAIN_WINDOW, type HistoryEvent } from './tracker';

// null rather than Infinity, which JSON would turn into null anyway.
export type AttentionParams = {
  // null: no decay.
  halfLifeHours: number | null;
  // null: attend to the concept's own answers only (the baseline).
  sharpness: number | null;
};

export const BASELINE: AttentionParams = { halfLifeHours: null, sharpness: null };

const HALF_LIVES = [6, 24, 72, 168, 720, null];
const SHARPNESS = [1, 2, 4, null];
const HOLDOUT_SHARE = 0.25;

export type AttentionAssessment = {
  trainTargets: number;
  holdoutTargets: number;
  loss: number | null;
  baselineLoss: number | null;
  trusted: boolean;
  reason: string;
};

export type AttentionModel = { params: AttentionParams; assessment: AttentionAssessment };

type Indexed = { c: number; t: number; y: number };

const index = (history: HistoryEvent[]): Indexed[] =>
  history
    .filter((e) => CONCEPT_INDEX.has(e.concept))
    .map((e) => ({ c: CONCEPT_INDEX.get(e.concept)!, t: Date.parse(e.at), y: e.correct ? 1 : 0 }));

// rel is stored in hundredths, so rel^sharpness takes one of 101 values per sharpness.
// Orthogonal (k = 0) is always 0, whatever the sharpness.
const relPowers = (sharpness: number | null): Float64Array =>
  new Float64Array(101).map((_, k) => (sharpness === null ? (k === 100 ? 1 : 0) : k === 0 ? 0 : (k / 100) ** sharpness));

const decayRate = (halfLifeHours: number | null) => (halfLifeHours === null ? 0 : Math.LN2 / (halfLifeHours * 3_600_000));

type Attended = { p: number; evidence: number };

/** Attends from concept `c` at time `t` over `events[0, upto)`. A Laplace prior keeps p inside (0, 1). */
const attend = (events: Indexed[], upto: number, c: number, t: number, pow: Float64Array, rate: number): Attended => {
  const n = CONCEPTS.length;
  const table = relationTable();
  let w = 0;
  let wy = 0;
  for (let j = 0; j < upto; j += 1) {
    const e = events[j];
    const r = pow[table[c * n + e.c]];
    if (r === 0) continue;
    const weight = rate === 0 ? r : r * Math.exp(-rate * Math.max(0, t - e.t));
    w += weight;
    wy += weight * e.y;
  }
  return { p: (wy + 1) / (w + 2), evidence: w };
};

const clampP = (p: number) => Math.min(1 - 1e-6, Math.max(1e-6, p));
const logLoss = (p: number, y: number) => -(y * Math.log(clampP(p)) + (1 - y) * Math.log(1 - clampP(p)));

/** Mean log loss of predicting each event in `targets` from every event before it. */
const meanLoss = (events: Indexed[], targets: (k: number) => boolean, params: AttentionParams): { loss: number; n: number } => {
  const pow = relPowers(params.sharpness);
  const rate = decayRate(params.halfLifeHours);
  let loss = 0;
  let n = 0;
  for (let k = 1; k < events.length; k += 1) {
    if (!targets(k)) continue;
    loss += logLoss(attend(events, k, events[k].c, events[k].t, pow, rate).p, events[k].y);
    n += 1;
  }
  return { loss: n ? loss / n : Infinity, n };
};

/**
 * Picks the half-life and sharpness with the lowest loss on the older answers, then
 * assesses them against the baseline on the newest ones, as fitTracker does.
 */
export const fitAttention = (allHistory: HistoryEvent[]): AttentionModel => {
  const history = [...allHistory].sort((a, b) => a.at.localeCompare(b.at)).slice(-TRAIN_WINDOW);
  const events = index(history);
  const cutoff = history[Math.floor(history.length * (1 - HOLDOUT_SHARE))]?.at ?? '';
  const cutoffMs = cutoff ? Date.parse(cutoff) : Infinity;
  const isTrain = (k: number) => events[k].t < cutoffMs;
  const trainTargets = events.filter((_, k) => k > 0 && isTrain(k)).length;
  const base: AttentionAssessment = { trainTargets, holdoutTargets: 0, loss: null, baselineLoss: null, trusted: false, reason: '' };
  if (trainTargets < MIN_TRAIN_TARGETS) {
    return { params: BASELINE, assessment: { ...base, reason: `Learning: ${trainTargets}/${MIN_TRAIN_TARGETS} answers before the attention weights are assessed.` } };
  }
  let best = BASELINE;
  let bestLoss = meanLoss(events, isTrain, BASELINE).loss;
  for (const halfLifeHours of HALF_LIVES) {
    for (const sharpness of SHARPNESS) {
      const params = { halfLifeHours, sharpness };
      if (halfLifeHours === null && sharpness === null) continue;
      const { loss } = meanLoss(events, isTrain, params);
      if (loss < bestLoss - 1e-9) {
        best = params;
        bestLoss = loss;
      }
    }
  }
  const held = meanLoss(events, (k) => !isTrain(k), best);
  const baseline = meanLoss(events, (k) => !isTrain(k), BASELINE);
  const assessment: AttentionAssessment = {
    ...base,
    holdoutTargets: held.n,
    loss: held.n ? held.loss : null,
    baselineLoss: baseline.n ? baseline.loss : null,
  };
  if (held.n < MIN_HOLDOUT_TARGETS) {
    return { params: best, assessment: { ...assessment, reason: `Assessing: ${held.n}/${MIN_HOLDOUT_TARGETS} held-out answers.` } };
  }
  if (best === BASELINE || held.loss >= baseline.loss) {
    return { params: best, assessment: { ...assessment, reason: 'Not trusted: related and recent answers do not yet predict better than each concept on its own.' } };
  }
  return { params: best, assessment: { ...assessment, trusted: true, reason: 'Trusted: related and recent answers predict better than each concept on its own.' } };
};

export type ConceptState = 'unseen' | 'learning' | 'struggling' | 'mastered';

export type ConceptEstimate = {
  // Chance the next answer on this concept is right.
  p: number;
  // Total attention weight behind p; 1 is one fresh answer on the concept itself.
  evidence: number;
  // The concept's own answers in the history.
  attempts: number;
  state: ConceptState;
  lastAt: string | null;
};

export const MASTERED_P = 0.85;
export const STRUGGLING_P = 0.5;
// A concept is only called mastered or struggling on its own answers, never on its neighbours'.
export const MASTERED_MIN_ATTEMPTS = 3;
export const STRUGGLING_MIN_ATTEMPTS = 2;

export const stateOf = (p: number, attempts: number): ConceptState => {
  if (attempts === 0) return 'unseen';
  if (attempts >= MASTERED_MIN_ATTEMPTS && p >= MASTERED_P) return 'mastered';
  if (attempts >= STRUGGLING_MIN_ATTEMPTS && p < STRUGGLING_P) return 'struggling';
  return 'learning';
};

export type MasteryMatrix = Map<string, ConceptEstimate>;

/**
 * The mastery matrix at `now`: every concept the history says anything about. The
 * fitted biases apply only while trusted; otherwise each concept is its own baseline.
 */
export const masteryMatrix = (model: AttentionModel | null, history: HistoryEvent[], now: string): MasteryMatrix => {
  const params = model?.assessment.trusted ? model.params : BASELINE;
  const events = index(history);
  const pow = relPowers(params.sharpness);
  const rate = decayRate(params.halfLifeHours);
  const t = Date.parse(now);
  const attempts = new Map<number, number>();
  const last = new Map<number, string>();
  history.forEach((e) => {
    const c = CONCEPT_INDEX.get(e.concept);
    if (c === undefined) return;
    attempts.set(c, (attempts.get(c) ?? 0) + 1);
    if ((last.get(c) ?? '') < e.at) last.set(c, e.at);
  });
  const out: MasteryMatrix = new Map();
  CONCEPTS.forEach((id, c) => {
    const { p, evidence } = attend(events, events.length, c, t, pow, rate);
    const own = attempts.get(c) ?? 0;
    if (evidence === 0 && own === 0) return;
    out.set(id, { p, evidence, attempts: own, state: stateOf(p, own), lastAt: last.get(c) ?? null });
  });
  return out;
};

export type MasteryEvent = 'mastery' | 'struggle';

/** Whether an answer moved `concept` into mastered or struggling: the matrix's save points. */
export const masteryEvent = (before: MasteryMatrix, after: MasteryMatrix, concept: string): MasteryEvent | null => {
  const was = before.get(concept)?.state ?? 'unseen';
  const now = after.get(concept)?.state ?? 'unseen';
  if (now === was) return null;
  return now === 'mastered' ? 'mastery' : now === 'struggling' ? 'struggle' : null;
};
