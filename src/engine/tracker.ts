// Progress tracker: an LSTM reads each concept's answer history and predicts
// whether the next answer will be correct (knowledge tracing). It is a hybrid
// with the guide's rules: the LSTM may only influence a decision once it has
// beaten a simple baseline on answers it was not trained on; until then the
// rules decide alone, and the rules can always hold the learner on a concept.

import { SETTING_BY_ID } from '../data/settings';
import { initLstm, predictSequence, train, type LstmParams, type Step } from './lstm';
import type { TeachingMode } from './scene';

export type HistoryEvent = {
  id: string;
  at: string;
  concept: string;
  correct: boolean;
  risk: number;
  mode: string;
  settingId: string;
  source: 'ai' | 'offline';
};

const MODES: TeachingMode[] = ['diagnostic', 'explain', 'guided', 'contrast', 'calculation', 'integration', 'remediation', 'maintenance'];
export const FEATURES = 6 + MODES.length;
const HIDDEN = 8;
const EPOCHS = 60;

// The model must have this much evidence before it is even assessed.
export const MIN_TRAIN_TARGETS = 30;
export const MIN_HOLDOUT_TARGETS = 12;
const HOLDOUT_SHARE = 0.25;
// Training uses the most recent answers only, which bounds its time.
export const TRAIN_WINDOW = 2000;

// Above this predicted chance of a correct next answer the LSTM agrees to move on.
export const ADVANCE_THRESHOLD = 0.65;
// The learner is never held on one link for more than this many confirmations.
export const MAX_CONFIRMATIONS = 2;

export const features = (e: HistoryEvent, prev: HistoryEvent | undefined): number[] => {
  const gapHours = prev ? Math.max(0, (Date.parse(e.at) - Date.parse(prev.at)) / 3_600_000) : 0;
  return [
    e.correct ? 1 : 0,
    e.correct ? 0 : 1,
    Math.min(1, e.risk / 4),
    SETTING_BY_ID.get(e.settingId)?.kind === 'unfamiliar' ? 1 : 0,
    e.source === 'ai' ? 1 : 0,
    Math.min(1, Math.log1p(gapHours) / 5),
    ...MODES.map((m) => (m === e.mode ? 1 : 0)),
  ];
};

/** Groups history by concept in time order. */
export const sequencesByConcept = (history: HistoryEvent[]): Map<string, HistoryEvent[]> => {
  const out = new Map<string, HistoryEvent[]>();
  for (const e of [...history].sort((a, b) => a.at.localeCompare(b.at))) {
    const list = out.get(e.concept) ?? [];
    list.push(e);
    out.set(e.concept, list);
  }
  return out;
};

/** Each answer predicts the next one on the same concept; `include` limits which targets count. */
const toSteps = (events: HistoryEvent[], include: (next: HistoryEvent) => boolean): Step[] =>
  events.map((e, t) => {
    const next = events[t + 1];
    return { x: features(e, events[t - 1]), target: next && include(next) ? (next.correct ? 1 : 0) : null };
  });

const clampP = (p: number) => Math.min(1 - 1e-6, Math.max(1e-6, p));
const logLoss = (p: number, y: number) => -(y * Math.log(clampP(p)) + (1 - y) * Math.log(1 - clampP(p)));

/** Baseline: the concept's own accuracy so far, with a Laplace prior. */
const baselineP = (events: HistoryEvent[], upto: number) => {
  const seen = events.slice(0, upto + 1);
  return (seen.filter((e) => e.correct).length + 1) / (seen.length + 2);
};

export type Assessment = {
  trainTargets: number;
  holdoutTargets: number;
  lstmLoss: number | null;
  baselineLoss: number | null;
  lstmAccuracy: number | null;
  baselineAccuracy: number | null;
  trusted: boolean;
  reason: string;
};

export type TrackerModel = { params: LstmParams; assessment: Assessment; trainedOn: number };

/**
 * Trains on the older answers, assesses on the newest ones against the
 * baseline, and, if the LSTM wins, retrains on everything for use. This is the
 * course's model assessment applied to the tutor itself.
 */
export const fitTracker = (allHistory: HistoryEvent[], seed = 7): TrackerModel => {
  const history = [...allHistory].sort((a, b) => a.at.localeCompare(b.at)).slice(-TRAIN_WINDOW);
  const byConcept = [...sequencesByConcept(history).values()];
  const times = history.map((e) => e.at).sort();
  const cutoff = times[Math.floor(times.length * (1 - HOLDOUT_SHARE))] ?? '';
  const isTrain = (e: HistoryEvent) => e.at < cutoff;

  const trainSeqs = byConcept.map((events) => toSteps(events.filter(isTrain), () => true));
  const trainTargets = trainSeqs.reduce((n, s) => n + s.filter((x) => x.target !== null).length, 0);

  const shape = { input: FEATURES, hidden: HIDDEN };
  const params = initLstm(shape, seed);
  const base: Assessment = {
    trainTargets, holdoutTargets: 0, lstmLoss: null, baselineLoss: null, lstmAccuracy: null, baselineAccuracy: null, trusted: false, reason: '',
  };
  if (trainTargets < MIN_TRAIN_TARGETS) {
    return { params, trainedOn: 0, assessment: { ...base, reason: `Learning: ${trainTargets}/${MIN_TRAIN_TARGETS} answers before the model is assessed.` } };
  }
  train(params, trainSeqs, { epochs: EPOCHS });

  let lstmLoss = 0, baseLoss = 0, lstmHit = 0, baseHit = 0, n = 0;
  for (const events of byConcept) {
    const preds = predictSequence(params, toSteps(events, () => true));
    for (let t = 0; t + 1 < events.length; t += 1) {
      const next = events[t + 1];
      if (isTrain(next)) continue;
      const y = next.correct ? 1 : 0;
      const pb = baselineP(events, t);
      lstmLoss += logLoss(preds[t], y);
      baseLoss += logLoss(pb, y);
      lstmHit += (preds[t] >= 0.5 ? 1 : 0) === y ? 1 : 0;
      baseHit += (pb >= 0.5 ? 1 : 0) === y ? 1 : 0;
      n += 1;
    }
  }
  const assessment: Assessment = {
    ...base,
    holdoutTargets: n,
    lstmLoss: n ? lstmLoss / n : null,
    baselineLoss: n ? baseLoss / n : null,
    lstmAccuracy: n ? lstmHit / n : null,
    baselineAccuracy: n ? baseHit / n : null,
  };
  if (n < MIN_HOLDOUT_TARGETS) {
    return { params, trainedOn: trainTargets, assessment: { ...assessment, reason: `Assessing: ${n}/${MIN_HOLDOUT_TARGETS} held-out answers.` } };
  }
  if (assessment.lstmLoss! >= assessment.baselineLoss!) {
    return { params, trainedOn: trainTargets, assessment: { ...assessment, reason: 'Not trusted: it does not yet beat the simple running-accuracy baseline on held-out answers.' } };
  }
  const final = initLstm(shape, seed);
  const allSeqs = byConcept.map((events) => toSteps(events, () => true));
  train(final, allSeqs, { epochs: EPOCHS });
  return {
    params: final,
    trainedOn: allSeqs.reduce((k, s) => k + s.filter((x) => x.target !== null).length, 0),
    assessment: { ...assessment, trusted: true, reason: 'Trusted: it beats the baseline on held-out answers.' },
  };
};

export type Trend = 'improving' | 'steady' | 'declining' | 'too-early';

export type ConceptForecast = { pNext: number; trend: Trend; curve: number[] };

/** The LSTM's view of one concept: chance the next answer is right, and which way it is heading. */
export const forecast = (model: TrackerModel, events: HistoryEvent[]): ConceptForecast | null => {
  if (events.length === 0) return null;
  const curve = predictSequence(model.params, toSteps(events, () => false));
  const pNext = curve[curve.length - 1];
  if (curve.length < 3) return { pNext, trend: 'too-early', curve };
  const delta = pNext - curve[Math.max(0, curve.length - 4)];
  return { pNext, trend: delta >= 0.1 ? 'improving' : delta <= -0.1 ? 'declining' : 'steady', curve };
};

export type GateDecision = {
  advance: boolean;
  decidedBy: 'rules' | 'rules+lstm';
  reason: string;
  forecast: ConceptForecast | null;
};

/**
 * The hybrid move-on decision after an answer on the current link.
 * Rules: a miss never advances; after a miss on this link, two correct answers
 * in a row are required (the guide's "corrected twice in new wording").
 * LSTM, only when trusted: a correct answer advances only if the predicted
 * chance of the next answer being right clears the threshold. Confirmations
 * are capped so the learner is never stuck on one link.
 */
export const decideAdvance = (input: {
  correct: boolean;
  missesOnStep: number;
  confirmationsOnStep: number;
  previousOnStepCorrect: boolean;
  model: TrackerModel | null;
  conceptHistory: HistoryEvent[];
}): GateDecision => {
  const trusted = input.model?.assessment.trusted ? input.model : null;
  const fc = input.model ? forecast(input.model, input.conceptHistory) : null;
  const decidedBy = trusted ? 'rules+lstm' : 'rules';
  if (!input.correct) return { advance: false, decidedBy, reason: 'A miss keeps this link in play.', forecast: fc };
  if (input.confirmationsOnStep >= MAX_CONFIRMATIONS) {
    return { advance: true, decidedBy, reason: 'Moving on; this link goes to the rematch queue if it is still shaky.', forecast: fc };
  }
  if (input.missesOnStep > 0 && !input.previousOnStepCorrect) {
    return { advance: false, decidedBy, reason: 'Right after a miss: one more from a new angle to confirm the fix.', forecast: fc };
  }
  if (trusted && fc && fc.pNext < ADVANCE_THRESHOLD) {
    return {
      advance: false,
      decidedBy,
      reason: `The progress model gives ${Math.round(fc.pNext * 100)}% for the next one (${fc.trend}); one more to confirm.`,
      forecast: fc,
    };
  }
  return {
    advance: true,
    decidedBy,
    reason: trusted && fc ? `Moving on: the progress model gives ${Math.round(fc.pNext * 100)}% for the next one (${fc.trend}).` : 'Moving on.',
    forecast: fc,
  };
};
