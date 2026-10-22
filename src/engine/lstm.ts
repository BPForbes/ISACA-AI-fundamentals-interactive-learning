// A small LSTM with one sigmoid output per step, trained by backpropagation
// through time with Adam. It is deliberately dependency-free: the progress
// tracker trains it in the browser on the learner's own answer history.
//
// Gates per step (H = hidden size, I = input size), z = W·[x; h_prev] + b:
//   i = σ(z_i)  input gate      f = σ(z_f)  forget gate
//   g = tanh(z_g) candidate     o = σ(z_o)  output gate
//   c = f⊙c_prev + i⊙g          h = o⊙tanh(c)
//   y = σ(v·h + b_out)          the probability that the next answer is correct

export type LstmShape = { input: number; hidden: number };

export type LstmParams = LstmShape & {
  // Row-major 4H × (I + H): rows [0,H) input gate, [H,2H) forget, [2H,3H) candidate, [3H,4H) output.
  W: Float64Array;
  b: Float64Array;
  v: Float64Array;
  bOut: number;
};

export type Step = { x: number[]; target: number | null };

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const EPS = 1e-7;

/** Deterministic PRNG (mulberry32) so initialization and training are reproducible. */
export const seededRng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export const initLstm = (shape: LstmShape, seed = 1): LstmParams => {
  const { input: I, hidden: H } = shape;
  const rng = seededRng(seed);
  const scale = 1 / Math.sqrt(I + H);
  const W = new Float64Array(4 * H * (I + H)).map(() => (rng() * 2 - 1) * scale);
  const b = new Float64Array(4 * H);
  // A positive forget bias keeps memory open early in training.
  for (let k = H; k < 2 * H; k += 1) b[k] = 1;
  const v = new Float64Array(H).map(() => (rng() * 2 - 1) * scale);
  return { input: I, hidden: H, W, b, v, bOut: 0 };
};

type Cache = { xh: Float64Array; i: Float64Array; f: Float64Array; g: Float64Array; o: Float64Array; c: Float64Array; cPrev: Float64Array; tanhC: Float64Array; h: Float64Array; y: number };

const forwardCached = (p: LstmParams, steps: Step[]): Cache[] => {
  const { input: I, hidden: H } = p;
  const cols = I + H;
  let h = new Float64Array(H);
  let c = new Float64Array(H);
  const caches: Cache[] = [];
  for (const step of steps) {
    const xh = new Float64Array(cols);
    xh.set(step.x.slice(0, I));
    xh.set(h, I);
    const i = new Float64Array(H), f = new Float64Array(H), g = new Float64Array(H), o = new Float64Array(H);
    for (let k = 0; k < H; k += 1) {
      const z = [p.b[k], p.b[H + k], p.b[2 * H + k], p.b[3 * H + k]];
      for (let gate = 0; gate < 4; gate += 1) {
        const row = (gate * H + k) * cols;
        let sum = z[gate];
        for (let j = 0; j < cols; j += 1) sum += p.W[row + j] * xh[j];
        z[gate] = sum;
      }
      i[k] = sigmoid(z[0]);
      f[k] = sigmoid(z[1]);
      g[k] = Math.tanh(z[2]);
      o[k] = sigmoid(z[3]);
    }
    const cPrev = c;
    c = new Float64Array(H);
    const tanhC = new Float64Array(H);
    const hNext = new Float64Array(H);
    let out = p.bOut;
    for (let k = 0; k < H; k += 1) {
      c[k] = f[k] * cPrev[k] + i[k] * g[k];
      tanhC[k] = Math.tanh(c[k]);
      hNext[k] = o[k] * tanhC[k];
      out += p.v[k] * hNext[k];
    }
    h = hNext;
    caches.push({ xh, i, f, g, o, c, cPrev, tanhC, h, y: sigmoid(out) });
  }
  return caches;
};

/** Probability after each step that the next answer is correct. */
export const predictSequence = (p: LstmParams, steps: Step[]): number[] => forwardCached(p, steps).map((c) => c.y);

export type Grads = { W: Float64Array; b: Float64Array; v: Float64Array; bOut: number };

const zeroGrads = (p: LstmParams): Grads => ({
  W: new Float64Array(p.W.length), b: new Float64Array(p.b.length), v: new Float64Array(p.v.length), bOut: 0,
});

/** Binary cross-entropy summed over steps that have a target, and its gradients (BPTT). */
export const lossAndGrads = (p: LstmParams, steps: Step[], grads: Grads = zeroGrads(p)): { loss: number; count: number; grads: Grads } => {
  const { input: I, hidden: H } = p;
  const cols = I + H;
  const caches = forwardCached(p, steps);
  let loss = 0;
  let count = 0;
  let dhNext = new Float64Array(H);
  let dcNext = new Float64Array(H);
  for (let t = steps.length - 1; t >= 0; t -= 1) {
    const cache = caches[t];
    const target = steps[t].target;
    const dh = new Float64Array(dhNext);
    if (target !== null) {
      const y = Math.min(1 - EPS, Math.max(EPS, cache.y));
      loss -= target * Math.log(y) + (1 - target) * Math.log(1 - y);
      count += 1;
      // d(BCE)/d(logit) = y − target for a sigmoid output.
      const dOut = cache.y - target;
      grads.bOut += dOut;
      for (let k = 0; k < H; k += 1) {
        grads.v[k] += dOut * cache.h[k];
        dh[k] += dOut * p.v[k];
      }
    }
    const dz = new Float64Array(4 * H);
    const dcPrev = new Float64Array(H);
    for (let k = 0; k < H; k += 1) {
      const dc = dcNext[k] + dh[k] * cache.o[k] * (1 - cache.tanhC[k] ** 2);
      dz[k] = dc * cache.g[k] * cache.i[k] * (1 - cache.i[k]);
      dz[H + k] = dc * cache.cPrev[k] * cache.f[k] * (1 - cache.f[k]);
      dz[2 * H + k] = dc * cache.i[k] * (1 - cache.g[k] ** 2);
      dz[3 * H + k] = dh[k] * cache.tanhC[k] * cache.o[k] * (1 - cache.o[k]);
      dcPrev[k] = dc * cache.f[k];
    }
    const dxh = new Float64Array(cols);
    for (let r = 0; r < 4 * H; r += 1) {
      if (dz[r] === 0) continue;
      grads.b[r] += dz[r];
      const row = r * cols;
      for (let j = 0; j < cols; j += 1) {
        grads.W[row + j] += dz[r] * cache.xh[j];
        dxh[j] += dz[r] * p.W[row + j];
      }
    }
    dhNext = dxh.slice(I);
    dcNext = dcPrev;
  }
  return { loss, count, grads };
};

export type TrainOptions = { epochs: number; learningRate?: number; l2?: number; clip?: number };

/**
 * Full-batch Adam over all sequences. Gradients are averaged per target and
 * clipped by global norm, which keeps a tiny dataset from exploding gradients.
 */
export const train = (p: LstmParams, sequences: Step[][], opts: TrainOptions): number[] => {
  const lr = opts.learningRate ?? 0.03;
  const l2 = opts.l2 ?? 1e-4;
  const clip = opts.clip ?? 5;
  const beta1 = 0.9;
  const beta2 = 0.999;
  const m = zeroGrads(p);
  const s = zeroGrads(p);
  const history: number[] = [];
  for (let epoch = 1; epoch <= opts.epochs; epoch += 1) {
    const g = zeroGrads(p);
    let loss = 0;
    let count = 0;
    for (const seq of sequences) {
      const r = lossAndGrads(p, seq, g);
      loss += r.loss;
      count += r.count;
    }
    if (count === 0) break;
    history.push(loss / count);
    let norm = g.bOut ** 2;
    for (const arr of [g.W, g.b, g.v]) for (let k = 0; k < arr.length; k += 1) norm += arr[k] ** 2;
    norm = Math.sqrt(norm) / count;
    const scale = (norm > clip ? clip / norm : 1) / count;
    const c1 = 1 - beta1 ** epoch;
    const c2 = 1 - beta2 ** epoch;
    const step = (param: Float64Array, grad: Float64Array, mm: Float64Array, ss: Float64Array, decay: boolean) => {
      for (let k = 0; k < param.length; k += 1) {
        const gk = grad[k] * scale + (decay ? l2 * param[k] : 0);
        mm[k] = beta1 * mm[k] + (1 - beta1) * gk;
        ss[k] = beta2 * ss[k] + (1 - beta2) * gk * gk;
        param[k] -= (lr * (mm[k] / c1)) / (Math.sqrt(ss[k] / c2) + 1e-8);
      }
    };
    step(p.W, g.W, m.W, s.W, true);
    step(p.b, g.b, m.b, s.b, false);
    step(p.v, g.v, m.v, s.v, true);
    const gb = g.bOut * scale;
    m.bOut = beta1 * m.bOut + (1 - beta1) * gb;
    s.bOut = beta2 * s.bOut + (1 - beta2) * gb * gb;
    p.bOut -= (lr * (m.bOut / c1)) / (Math.sqrt(s.bOut / c2) + 1e-8);
  }
  return history;
};
