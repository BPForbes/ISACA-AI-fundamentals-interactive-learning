// Lab challenges: one per chain anchor the lab can teach. Each drops the learner
// into a broken lab (the setup) with a goal the simulation judges; the way to
// meet it is the concept the anchor names. The brief is story framing in the
// expedition's setting, fictional and written as a hypothetical; the definitions
// the debrief shows come from the term bank, never from here. A challenge has a
// solution so that tests can prove every setup is solvable and the lab can hint
// after repeated misses.

import { defaultLab, type LabConfig, type LabResult } from '../engine/lab';
import type { StorySetting } from './settings';

export type Stage = 'data' | 'train' | 'evaluate';

export type Challenge = {
  anchor: string;
  stage: Stage;
  brief: (setting: StorySetting) => string;
  setup: (seed: number) => LabConfig;
  goal: { text: string; met: (r: LabResult) => boolean };
  solution: (config: LabConfig) => LabConfig;
  // Terms the debrief names, the anchor first.
  terms: string[];
  readout: (r: LabResult) => string;
};

const lead = (setting: StorySetting) => `${setting.cast[0].split(',')[0]}, ${setting.name}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const loss = (r: LabResult) => `validation loss ${r.valLoss.toFixed(2)}`;
const data = (seed: number, patch: Partial<LabConfig['data']>): LabConfig => {
  const c = defaultLab(seed);
  return { ...c, data: { ...c.data, ...patch } };
};
const model = (seed: number, patch: Partial<LabConfig['model']>, extra: Partial<LabConfig> = {}): LabConfig => {
  const c = defaultLab(seed);
  return { ...c, ...extra, model: { ...c.model, ...patch } };
};
const withData = (c: LabConfig, patch: Partial<LabConfig['data']>): LabConfig => ({ ...c, data: { ...c.data, ...patch } });
const withModel = (c: LabConfig, patch: Partial<LabConfig['model']>): LabConfig => ({ ...c, model: { ...c.model, ...patch } });

// Validation loss a sound setup reaches on this data; goals sit a little above it.
export const SOUND_LOSS = 0.42;
// The same in the world that bends more (curvature 6), where a sound model lands a little higher.
export const BENT_LOSS = 0.45;
export const COMPUTE_BUDGET = 1000;

export const CHALLENGES: Challenge[] = [
  // ---------- data ----------
  {
    anchor: 'convenience-sampling',
    stage: 'data',
    brief: (s) => `${lead(s)}: "Suppose we trained on the cases we already had to hand, the ones nearest the office. The model looks fine on them, and falls apart on everyone else. Build a training set the whole population is in."`,
    setup: (seed) => data(seed, { sampling: 'convenience' }),
    goal: { text: `Validation loss at or under ${SOUND_LOSS.toFixed(2)}, and accuracy on the minority group at least 70%.`, met: (r) => r.valLoss <= SOUND_LOSS && r.groups.minority >= 0.7 },
    solution: (c) => withData(c, { sampling: 'stratified' }),
    terms: ['convenience-sampling', 'representativeness', 'stratified-sampling', 'nonprobability-sampling'],
    readout: (r) => `${loss(r)}; minority group ${pct(r.dataset.groupShare.sample)} of the sample against ${pct(r.dataset.groupShare.population)} of the population; minority accuracy ${pct(r.groups.minority)}`,
  },
  {
    anchor: 'data-cleansing',
    stage: 'data',
    brief: (s) => `${lead(s)}: "Suppose the export we were given has rows pasted in twice and a batch of readings no instrument could have produced. The pilot is a simple linear scorer, and those rows drag it off. Prepare the data first."`,
    setup: (seed) => withModel(data(seed, { duplicates: 0.3, outliers: 20 }), { depth: 0 }),
    goal: { text: `Validation loss at or under ${SOUND_LOSS.toFixed(2)}.`, met: (r) => r.valLoss <= SOUND_LOSS },
    solution: (c) => withData(c, { cleanse: true }),
    terms: ['data-cleansing', 'outlier', 'data-quality'],
    readout: (r) => `${loss(r)}; ${r.dataset.sample.length} rows handed over, ${r.dataset.removed} removed by cleansing`,
  },
  {
    anchor: 'training-data',
    stage: 'data',
    brief: (s) => `${lead(s)}: "Suppose the pilot was built on two dozen rows because that is all anyone had labelled. Its parameters are learned from almost nothing. Get it the data it needs to learn from."`,
    setup: (seed) => withModel(data(seed, { sampleSize: 20, curvature: 6 }), { epochs: 60 }),
    goal: { text: `Validation loss at or under ${BENT_LOSS.toFixed(2)}.`, met: (r) => r.valLoss <= BENT_LOSS },
    solution: (c) => withData(c, { sampleSize: 120 }),
    terms: ['training-data', 'generalization', 'data-augmentation'],
    readout: (r) => `${loss(r)}; ${r.dataset.train.length} training rows`,
  },
  {
    anchor: 'data-quality',
    stage: 'data',
    brief: (s) => `${lead(s)}: "Suppose a quarter of the labels came from a form people filled in wrong, and a fifth of the rows are repeats. The data is not fit for the purpose yet. Make it so."`,
    setup: (seed) => data(seed, { labelNoise: 0.25, duplicates: 0.2 }),
    goal: { text: `Validation loss at or under ${SOUND_LOSS.toFixed(2)}.`, met: (r) => r.valLoss <= SOUND_LOSS },
    solution: (c) => withData(c, { verifyLabels: true, cleanse: true }),
    terms: ['data-quality', 'data-cleansing', 'gigo'],
    readout: (r) => `${loss(r)}; ${r.dataset.corrected} labels corrected, ${r.dataset.removed} rows removed`,
  },
  {
    anchor: 'gigo',
    stage: 'data',
    brief: (s) => `${lead(s)}: "Suppose a third of the training labels are simply wrong and a handful of rows are nonsense. Whatever the model learns from that, it learns faithfully. Fix what goes in."`,
    setup: (seed) => data(seed, { labelNoise: 0.35, outliers: 10 }),
    goal: { text: `Validation loss at or under ${SOUND_LOSS.toFixed(2)}.`, met: (r) => r.valLoss <= SOUND_LOSS },
    solution: (c) => withData(c, { verifyLabels: true, cleanse: true }),
    terms: ['gigo', 'data-quality', 'data-cleansing'],
    readout: (r) => `${loss(r)}; ${r.dataset.corrected} labels corrected, ${r.dataset.removed} rows removed`,
  },
  {
    anchor: 'data-poisoning',
    stage: 'data',
    brief: (s) => `${lead(s)}: "Suppose someone with access to the labelling queue flipped a share of the labels on purpose before training. The model now does what they wanted. Check the labels against their source before you train again."`,
    setup: (seed) => data(seed, { labelNoise: 0.3 }),
    goal: { text: `Validation loss at or under ${SOUND_LOSS.toFixed(2)}.`, met: (r) => r.valLoss <= SOUND_LOSS },
    solution: (c) => withData(c, { verifyLabels: true }),
    terms: ['data-poisoning', 'integrity', 'provenance'],
    readout: (r) => `${loss(r)}; ${r.dataset.corrected} labels corrected`,
  },
  {
    anchor: 'fairness-testing',
    stage: 'data',
    brief: (s) => `${lead(s)}: "Suppose the model's overall accuracy looks fine, and a reviewer asks how it does for the smaller group of cases on its own. Test that, and close the gap."`,
    setup: (seed) => data(seed, { sampling: 'convenience' }),
    goal: { text: 'Accuracy gap between the two groups of 12 points or less, with overall accuracy at least 75%.', met: (r) => r.groups.gap <= 0.12 && r.metrics.accuracy >= 0.75 },
    solution: (c) => withData(c, { sampling: 'stratified' }),
    terms: ['fairness-testing', 'sampling-bias', 'representation-bias', 'stratified-sampling'],
    readout: (r) => `accuracy ${pct(r.metrics.accuracy)} overall, ${pct(r.groups.majority)} for the majority group and ${pct(r.groups.minority)} for the minority (gap ${Math.round(r.groups.gap * 100)} points)`,
  },
  // ---------- train ----------
  {
    anchor: 'parameter-update',
    stage: 'train',
    brief: (s) => `${lead(s)}: "Suppose training was stopped after two passes through the data to save time. The parameters have barely moved from where they started. Train it until the loss settles."`,
    setup: (seed) => model(seed, { epochs: 2 }),
    goal: { text: `Validation loss at or under ${SOUND_LOSS.toFixed(2)}.`, met: (r) => r.valLoss <= SOUND_LOSS },
    solution: (c) => withModel(c, { epochs: 30 }),
    terms: ['parameter-update', 'epoch', 'gradient', 'training'],
    readout: (r) => `${loss(r)} after ${r.training.curve.length} epoch${r.training.curve.length === 1 ? '' : 's'}`,
  },
  {
    anchor: 'parameter',
    stage: 'train',
    brief: (s) => `${lead(s)}: "Suppose the model is a single straight line through the data: three learned values in all. The pattern bends, and the line cannot. Give it the parameters it needs."`,
    setup: (seed) => withData(model(seed, { depth: 0, epochs: 60 }), { curvature: 6 }),
    goal: { text: `Validation loss at or under ${BENT_LOSS.toFixed(2)}.`, met: (r) => r.valLoss <= BENT_LOSS },
    solution: (c) => withModel(c, { depth: 1 }),
    terms: ['parameter', 'weight', 'depth', 'underfitting'],
    readout: (r) => `${loss(r)} with ${r.training.paramCount} parameters`,
  },
  {
    anchor: 'generalization',
    stage: 'train',
    brief: (s) => `${lead(s)}: "Suppose the model scores almost perfectly on its own training rows and badly on anything new. It has memorised the sample. Make it learn the pattern instead."`,
    setup: (seed) => withData(model(seed, { depth: 2, hidden: 16, epochs: 60, learningRate: 1, l2: 0 }), { sampleSize: 24 }),
    goal: { text: `Validation loss at or under ${SOUND_LOSS.toFixed(2)}, with no sign of overfitting in the curve.`, met: (r) => r.valLoss <= SOUND_LOSS && r.diagnosis.kind !== 'overfitting' },
    solution: (c) => withData(withModel(c, { depth: 1, hidden: 6, epochs: 30, learningRate: 0.3, l2: 0.01 }), { sampleSize: 120 }),
    terms: ['generalization', 'overfitting', 'regularization', 'model-assessment'],
    readout: (r) => `training loss ${r.trainLoss.toFixed(2)}, ${loss(r)}; ${r.diagnosis.kind}`,
  },
  {
    anchor: 'model-assessment',
    stage: 'train',
    brief: (s) => `${lead(s)}: "Suppose the report says the model is excellent, and the number in it was measured on the rows the model trained on. Assess it properly, and get it to a result that holds on data it has not seen."`,
    setup: (seed) => withData(model(seed, { depth: 2, hidden: 16, epochs: 60, learningRate: 1, l2: 0 }, { assessOn: 'train' }), { sampleSize: 24 }),
    goal: { text: `A loss at or under ${SOUND_LOSS.toFixed(2)} measured on held-out rows. A loss measured on training rows does not count.`, met: (r) => r.config.assessOn === 'validation' && r.valLoss <= SOUND_LOSS },
    solution: (c) => withData(withModel({ ...c, assessOn: 'validation' }, { depth: 1, hidden: 6, epochs: 30, learningRate: 0.3, l2: 0.01 }), { sampleSize: 120 }),
    terms: ['model-assessment', 'overfitting', 'generalization'],
    readout: (r) => `reported loss ${r.reportedLoss.toFixed(2)} on ${r.config.assessOn === 'train' ? 'training rows' : 'held-out rows'} (training ${r.trainLoss.toFixed(2)}, validation ${r.valLoss.toFixed(2)})`,
  },
  {
    anchor: 'technical-feasibility',
    stage: 'train',
    brief: (s) => `${lead(s)}: "Suppose the design is two hidden layers trained for forty passes, and the compute we can actually run is a fraction of that. Find a model the team can run that still does the job."`,
    setup: (seed) => model(seed, { depth: 2, epochs: 40 }),
    goal: { text: `Validation loss at or under ${SOUND_LOSS.toFixed(2)} using at most ${COMPUTE_BUDGET} units of compute (parameters × epochs).`, met: (r) => r.valLoss <= SOUND_LOSS && r.compute <= COMPUTE_BUDGET },
    solution: (c) => withModel(c, { depth: 1, epochs: 30 }),
    terms: ['technical-feasibility', 'model-compression', 'depth', 'parameter'],
    readout: (r) => `${loss(r)}; ${r.training.paramCount} parameters × ${r.training.curve.length} epochs = ${r.compute} compute`,
  },
  // ---------- evaluate ----------
  {
    anchor: 'confusion-matrix',
    stage: 'evaluate',
    brief: (s) => `${lead(s)}: "Suppose the model only flags a case when it is almost certain, so the matrix is lopsided: nearly everything positive is being missed. Set the threshold so both kinds of error stay small, and read the four cells back to me."`,
    setup: (seed) => ({ ...defaultLab(seed), threshold: 0.95 }),
    goal: { text: 'At most 10 false negatives and at most 12 false positives on the 100 validation cases.', met: (r) => r.metrics.fn <= 10 && r.metrics.fp <= 12 },
    solution: (c) => ({ ...c, threshold: 0.5 }),
    terms: ['confusion-matrix', 'tp', 'fn', 'fp', 'tn'],
    readout: (r) => `TP ${r.metrics.tp}, FN ${r.metrics.fn}, FP ${r.metrics.fp}, TN ${r.metrics.tn} at threshold ${r.config.threshold.toFixed(2)}`,
  },
  {
    anchor: 'recall',
    stage: 'evaluate',
    brief: (s) => `${lead(s)}: "Suppose a missed positive case costs far more than a false alarm. The model is tuned the other way round. Find the threshold where almost no real case is missed, without flagging everyone."`,
    setup: (seed) => ({ ...defaultLab(seed), threshold: 0.8 }),
    goal: { text: 'Recall at least 90% with precision at least 60%.', met: (r) => r.metrics.recall >= 0.9 && r.metrics.precision >= 0.6 },
    solution: (c) => ({ ...c, threshold: 0.3 }),
    terms: ['recall', 'precision', 'specificity', 'accuracy'],
    readout: (r) => `recall ${pct(r.metrics.recall)}, precision ${pct(r.metrics.precision)}, specificity ${pct(r.metrics.specificity)}, accuracy ${pct(r.metrics.accuracy)} at threshold ${r.config.threshold.toFixed(2)}`,
  },
  {
    anchor: 'kpi',
    stage: 'evaluate',
    brief: (s) => `${lead(s)}: "Suppose the objective is that no case needing attention gets missed. The dashboard proudly shows accuracy. Pick the indicator that actually measures progress toward that objective, and hit the number."`,
    setup: (seed) => ({ ...defaultLab(seed), threshold: 0.7, kpi: 'accuracy' }),
    goal: { text: 'Report the metric that measures the objective as the KPI, at 85% or better.', met: (r) => r.config.kpi === 'recall' && r.metrics.recall >= 0.85 },
    solution: (c) => ({ ...c, threshold: 0.3, kpi: 'recall' }),
    terms: ['kpi', 'kgi', 'recall', 'accuracy'],
    readout: (r) => `KPI ${r.config.kpi ?? 'none'}; recall ${pct(r.metrics.recall)}, accuracy ${pct(r.metrics.accuracy)} at threshold ${r.config.threshold.toFixed(2)}`,
  },
  {
    anchor: 'model-drift',
    stage: 'evaluate',
    brief: (s) => `${lead(s)}: "Suppose the model passed every check when it shipped, and this quarter's cases look different from last year's. Its scores on the latest cases have slid. Find out why, and bring it back."`,
    setup: (seed) => data(seed, { drift: 0.9 }),
    goal: { text: 'Accuracy of at least 78% on the latest cases.', met: (r) => r.testMetrics.accuracy >= 0.78 },
    solution: (c) => withData(c, { recent: true }),
    terms: ['model-drift', 'monitoring', 'generalization'],
    readout: (r) => `accuracy ${pct(r.metrics.accuracy)} on last year's validation cases, ${pct(r.testMetrics.accuracy)} on the latest cases`,
  },
];

export const CHALLENGE_BY_ANCHOR: ReadonlyMap<string, Challenge> = new Map(CHALLENGES.map((c) => [c.anchor, c]));

export const challengeFor = (anchor: string): Challenge | undefined => CHALLENGE_BY_ANCHOR.get(anchor);
