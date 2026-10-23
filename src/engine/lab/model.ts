// The lab's model: a small network (linear, or one or two tanh hidden layers) with
// a sigmoid output, trained by mini-batch gradient descent with L2 regularization.
// It is real training on the lab's data, kept tiny so it runs on every change of
// a control. The curve it returns is what the train-stage challenges read.

import { seededRng } from '../lstm';
import type { Point } from './dataset';

export type ModelConfig = {
  depth: 0 | 1 | 2;
  hidden: number;
  learningRate: number;
  epochs: number;
  batchSize: number;
  l2: number;
  seed: number;
};

export type EpochLoss = { train: number; val: number };

export type TrainResult = {
  curve: EpochLoss[];
  diverged: boolean;
  paramCount: number;
  predict: (x: number, y: number) => number;
};

export const defaultModel = (seed: number): ModelConfig => ({ depth: 1, hidden: 6, learningRate: 0.3, epochs: 30, batchSize: 16, l2: 0, seed });

export const LEARNING_RATES = [0.01, 0.03, 0.1, 0.3, 1, 3] as const;
export const L2_STEPS = [0, 0.001, 0.01, 0.03, 0.1] as const;
export const BATCH_SIZES = [8, 16, 32, 120] as const;
export const HIDDEN_SIZES = [4, 6, 8, 16] as const;
export const MAX_EPOCHS = 60;

type Layer = { w: Float64Array; b: Float64Array; inputs: number; outputs: number };

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const clampP = (p: number) => Math.min(1 - 1e-7, Math.max(1e-7, p));
const logLoss = (p: number, y: number) => -(y * Math.log(clampP(p)) + (1 - y) * Math.log(1 - clampP(p)));

const makeLayer = (inputs: number, outputs: number, rng: () => number): Layer => ({
  w: new Float64Array(inputs * outputs).map(() => (rng() * 2 - 1) / Math.sqrt(inputs)),
  b: new Float64Array(outputs),
  inputs,
  outputs,
});

const forward = (layers: Layer[], x: number, y: number): { activations: Float64Array[]; p: number } => {
  let a = Float64Array.from([x, y]);
  const activations = [a];
  layers.forEach((layer, i) => {
    const out = new Float64Array(layer.outputs);
    for (let o = 0; o < layer.outputs; o += 1) {
      let z = layer.b[o];
      for (let k = 0; k < layer.inputs; k += 1) z += layer.w[o * layer.inputs + k] * a[k];
      out[o] = i === layers.length - 1 ? sigmoid(z) : Math.tanh(z);
    }
    a = out;
    activations.push(a);
  });
  return { activations, p: a[0] };
};

export const paramCount = (cfg: ModelConfig): number => {
  const sizes = [2, ...Array.from({ length: cfg.depth }, () => cfg.hidden), 1];
  return sizes.slice(1).reduce((n, out, i) => n + out * (sizes[i] + 1), 0);
};

export const meanLoss = (layers: Layer[], points: Point[]): number =>
  points.length ? points.reduce((sum, p) => sum + logLoss(forward(layers, p.x, p.y).p, p.label), 0) / points.length : 0;

export const trainModel = (cfg: ModelConfig, train: Point[], validation: Point[]): TrainResult => {
  const rng = seededRng(cfg.seed);
  const sizes = [2, ...Array.from({ length: cfg.depth }, () => cfg.hidden), 1];
  const layers = sizes.slice(1).map((out, i) => makeLayer(sizes[i], out, rng));
  const curve: EpochLoss[] = [];
  let diverged = false;
  const order = train.map((_, i) => i);
  const batch = Math.max(1, Math.min(cfg.batchSize, train.length));

  for (let epoch = 0; epoch < cfg.epochs && !diverged; epoch += 1) {
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (let start = 0; start < order.length; start += batch) {
      const idx = order.slice(start, start + batch);
      const grads = layers.map((l) => ({ w: new Float64Array(l.w.length), b: new Float64Array(l.b.length) }));
      for (const i of idx) {
        const p = train[i];
        const { activations, p: out } = forward(layers, p.x, p.y);
        // Backpropagation: the output error, then through each tanh layer.
        let delta = Float64Array.from([out - p.label]);
        for (let l = layers.length - 1; l >= 0; l -= 1) {
          const layer = layers[l];
          const input = activations[l];
          const next = new Float64Array(layer.inputs);
          for (let o = 0; o < layer.outputs; o += 1) {
            grads[l].b[o] += delta[o];
            for (let k = 0; k < layer.inputs; k += 1) {
              grads[l].w[o * layer.inputs + k] += delta[o] * input[k];
              next[k] += delta[o] * layer.w[o * layer.inputs + k];
            }
          }
          if (l > 0) for (let k = 0; k < layer.inputs; k += 1) next[k] *= 1 - input[k] * input[k];
          delta = next;
        }
      }
      // The parameter update: a step against the gradient, with L2 pulling weights toward zero.
      const step = cfg.learningRate / idx.length;
      layers.forEach((layer, l) => {
        for (let k = 0; k < layer.w.length; k += 1) layer.w[k] -= step * grads[l].w[k] + cfg.learningRate * cfg.l2 * layer.w[k];
        for (let k = 0; k < layer.b.length; k += 1) layer.b[k] -= step * grads[l].b[k];
      });
    }
    const point = { train: meanLoss(layers, train), val: meanLoss(layers, validation) };
    if (!Number.isFinite(point.train) || !Number.isFinite(point.val) || point.train > 4) diverged = true;
    curve.push(point);
  }
  return { curve, diverged, paramCount: paramCount(cfg), predict: (x, y) => forward(layers, x, y).p };
};
