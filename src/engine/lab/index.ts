// One lab run, the whole lifecycle: define the problem, build the data, train the
// model, decide how cases are decided (rules, the model, a reviewer, a threshold),
// and deploy for six months. A goal judges the result; the lab view draws it.

import { buildDataset, defaultData, drawCases, type DataConfig, type Dataset, type Point } from './dataset';
import { defaultDeploy, defaultPricing, monthlyCompute, simulate, type DeployConfig, type DeployResult, type Pricing } from './deploy';
import { confusion, groupAccuracy, scoreAll, type Confusion, type MetricId, type Scored } from './metrics';
import { defaultFeatures, defaultModel, trainModel, type Features, type ModelConfig, type TrainResult } from './model';
import { decide, decisionStats, defaultReview, type Approach, type Decision, type DecisionStats, type Review, type Rule } from './rules';

export type Problem = {
  capability: 'classification' | 'generation' | 'perception' | 'forecasting';
  paradigm: 'supervised' | 'unsupervised' | 'reinforcement';
  scope: 'narrow' | 'general';
};

export type WorldConfig = {
  // Drift the deployed world gains each month, and the value the business needs over six months.
  driftPerMonth: number;
  kgiTarget: number;
};

export type LabConfig = {
  problem: Problem;
  data: DataConfig;
  features: Features;
  model: ModelConfig;
  approach: Approach;
  rules: Rule[];
  review: Review;
  threshold: number;
  // Which rows the reported loss is measured on: the model's own training rows, or held-out ones.
  assessOn: 'train' | 'validation';
  // The metric the team reports as its KPI, once chosen.
  kpi: MetricId | null;
  deploy: DeployConfig;
  world: WorldConfig;
  // What the run's upgrades have done to running costs; set when the project is planned.
  pricing: Pricing;
};

export type Diagnosis = {
  kind: 'diverged' | 'overfitting' | 'underfitting' | 'undertrained' | 'converged' | 'empty';
  text: string;
};

export type LabResult = {
  config: LabConfig;
  // The problem as defined can be solved by a trained classifier.
  problemOk: boolean;
  dataset: Dataset;
  training: TrainResult;
  validation: Scored[];
  test: Scored[];
  // Metrics at the threshold from the model's scores alone, on the validation set and on the test set.
  metrics: Confusion;
  testMetrics: Confusion;
  groups: { majority: number; minority: number; gap: number };
  // How cases are actually decided under the chosen approach, and what that gives.
  decisions: Decision[];
  decided: DecisionStats;
  trainLoss: number;
  valLoss: number;
  reportedLoss: number;
  // Compute the training used, and what the model costs to run each month.
  compute: number;
  monthlyCompute: number;
  diagnosis: Diagnosis;
  deploy: DeployResult;
};

export const defaultLab = (seed: number): LabConfig => ({
  problem: { capability: 'classification', paradigm: 'supervised', scope: 'narrow' },
  data: defaultData(seed),
  features: defaultFeatures(),
  model: defaultModel(seed),
  approach: 'ml',
  rules: [],
  review: defaultReview(),
  threshold: 0.5,
  assessOn: 'validation',
  kpi: null,
  deploy: defaultDeploy(),
  world: { driftPerMonth: 0.2, kgiTarget: 800 },
  pricing: defaultPricing(),
});

const last = (r: TrainResult) => r.curve[r.curve.length - 1];

/** Reads the loss curve the way the course describes training going wrong. */
export const diagnose = (training: TrainResult): Diagnosis => {
  if (training.curve.length === 0) return { kind: 'empty', text: 'No training has run.' };
  if (training.diverged) return { kind: 'diverged', text: 'The loss blew up: each parameter update overshot, so training diverged instead of settling.' };
  const end = last(training);
  const minVal = Math.min(...training.curve.map((e) => e.val));
  const minAt = training.curve.findIndex((e) => e.val === minVal);
  const first = training.curve[0];
  if (end.val > minVal + 0.04 && end.train < first.train && minAt < training.curve.length - 3) {
    return { kind: 'overfitting', text: `Validation loss bottomed out at epoch ${minAt + 1} (${minVal.toFixed(2)}) and has risen to ${end.val.toFixed(2)} while training loss keeps falling: the model is fitting the training rows, not the pattern.` };
  }
  if (end.train > 0.55 && first.train - end.train < 0.12) {
    return { kind: 'underfitting', text: `Training loss is still ${end.train.toFixed(2)}: the model cannot capture the pattern even in its own training data.` };
  }
  if (end.train > 0.45 && end.train < first.train - 0.1 && training.curve.length >= 2) {
    const prev = training.curve[training.curve.length - 2];
    if (prev.train - end.train > 0.005) return { kind: 'undertrained', text: `Loss is still falling (${end.train.toFixed(2)} and dropping): training stopped before it settled.` };
  }
  return { kind: 'converged', text: `Training settled: training loss ${end.train.toFixed(2)}, validation loss ${end.val.toFixed(2)}.` };
};

// A general-scope system is costed as if it had to do everything.
const GENERAL_SCOPE_COMPUTE = 10;

const untrained = (paramCount: number): TrainResult => ({ curve: [], diverged: false, paramCount, predict: () => 0.5 });

export const runLab = (config: LabConfig): LabResult => {
  const dataset = buildDataset(config.data);
  const problemOk = config.problem.capability === 'classification' && config.problem.paradigm === 'supervised';
  // A problem defined as something other than supervised classification trains nothing useful on labelled cases.
  const training = problemOk
    ? trainModel(config.model, config.features, dataset.train, dataset.validation)
    : untrained(trainModel({ ...config.model, epochs: 0 }, config.features, dataset.train, dataset.validation).paramCount);
  const scopeFactor = config.problem.scope === 'general' ? GENERAL_SCOPE_COMPUTE : 1;
  const paramCount = training.paramCount * scopeFactor;
  // A lab saved before pricing existed runs at list price.
  const pricing = config.pricing ?? defaultPricing();
  const validation = scoreAll(training.predict, dataset.validation);
  const test = scoreAll(training.predict, dataset.test);
  const routing = { approach: config.approach, rules: config.rules, review: config.review, threshold: config.threshold, seed: config.data.seed };
  // A problem that trains nothing decides nothing: every case falls to the default.
  const decisions = problemOk ? decide(routing, validation) : validation.map((): Decision => ({ source: 'default', predicted: 0, rule: null }));
  const end = training.curve.length ? last(training) : { train: Number.NaN, val: Number.NaN };
  const trainMeanX = dataset.train.length ? dataset.train.reduce((s, p) => s + p.x, 0) / dataset.train.length : 0;
  const decidedAsScored = decisions.map((d, i) => ({ ...validation[i], score: d.predicted }));
  const deploy = simulate(
    { config: config.deploy, routing, model: training, paramCount, pricing, seed: config.data.seed, launchGap: groupAccuracy(decidedAsScored, 0.5).gap },
    {
      draw: (n: number, drift: number, rng: () => number): Point[] => drawCases(rng, n, drift, config.data.curvature),
      retrain: (recent: Point[]) => (problemOk ? trainModel(config.model, config.features, recent, dataset.validation) : training),
      driftPerMonth: config.world.driftPerMonth,
      kgiTarget: config.world.kgiTarget,
      trainMeanX,
    },
  );
  return {
    config,
    problemOk,
    dataset,
    training: { ...training, paramCount },
    validation,
    test,
    metrics: confusion(validation, config.threshold),
    testMetrics: confusion(test, config.threshold),
    groups: groupAccuracy(validation, config.threshold),
    decisions,
    decided: decisionStats(decisions, validation),
    trainLoss: end.train,
    valLoss: end.val,
    reportedLoss: config.assessOn === 'train' ? end.train : end.val,
    compute: paramCount * training.curve.length,
    monthlyCompute: monthlyCompute(paramCount, pricing),
    diagnosis: diagnose(training),
    deploy,
  };
};
