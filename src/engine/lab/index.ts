// One lab run: build the data, train the model, score the held-out sets, read the
// curve. A challenge judges the result; the lab view draws it.

import { buildDataset, defaultData, type DataConfig, type Dataset } from './dataset';
import { confusion, groupAccuracy, scoreAll, type Confusion, type MetricId, type Scored } from './metrics';
import { defaultModel, trainModel, type ModelConfig, type TrainResult } from './model';

export type LabConfig = {
  data: DataConfig;
  model: ModelConfig;
  threshold: number;
  // Which rows the reported loss is measured on: the model's own training rows, or held-out ones.
  assessOn: 'train' | 'validation';
  // The metric the team reports as its KPI, once chosen.
  kpi: MetricId | null;
};

export type Diagnosis = {
  kind: 'diverged' | 'overfitting' | 'underfitting' | 'undertrained' | 'converged' | 'empty';
  text: string;
};

export type LabResult = {
  config: LabConfig;
  dataset: Dataset;
  training: TrainResult;
  validation: Scored[];
  test: Scored[];
  // Metrics at the threshold, on the validation set and on the test set.
  metrics: Confusion;
  testMetrics: Confusion;
  groups: { majority: number; minority: number; gap: number };
  // Final losses, the loss on the rows the team chose to assess on, and the compute the training used.
  trainLoss: number;
  valLoss: number;
  reportedLoss: number;
  compute: number;
  diagnosis: Diagnosis;
};

export const defaultLab = (seed: number): LabConfig => ({ data: defaultData(seed), model: defaultModel(seed), threshold: 0.5, assessOn: 'validation', kpi: null });

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

export const runLab = (config: LabConfig): LabResult => {
  const dataset = buildDataset(config.data);
  const training = trainModel(config.model, dataset.train, dataset.validation);
  const validation = scoreAll(training.predict, dataset.validation);
  const test = scoreAll(training.predict, dataset.test);
  const end = training.curve.length ? last(training) : { train: Number.NaN, val: Number.NaN };
  return {
    config,
    dataset,
    training,
    validation,
    test,
    metrics: confusion(validation, config.threshold),
    testMetrics: confusion(test, config.threshold),
    groups: groupAccuracy(validation, config.threshold),
    trainLoss: end.train,
    valLoss: end.val,
    reportedLoss: config.assessOn === 'train' ? end.train : end.val,
    compute: training.paramCount * training.curve.length,
    diagnosis: diagnose(training),
  };
};
