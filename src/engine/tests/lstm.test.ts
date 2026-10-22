import { describe, expect, it } from 'vitest';
import { initLstm, lossAndGrads, predictSequence, seededRng, train, type Step } from '../lstm';

const randomSeq = (rng: () => number, len: number, input: number): Step[] =>
  Array.from({ length: len }, (_, t) => ({
    x: Array.from({ length: input }, () => rng()),
    target: t % 2 === 0 ? (rng() > 0.5 ? 1 : 0) : null,
  }));

describe('lstm', () => {
  it('matches finite-difference gradients (BPTT is correct)', () => {
    const p = initLstm({ input: 3, hidden: 4 }, 3);
    const seq = randomSeq(seededRng(9), 5, 3);
    const { grads } = lossAndGrads(p, seq);
    const h = 1e-5;
    const check = (arr: Float64Array, g: Float64Array, idx: number) => {
      const orig = arr[idx];
      arr[idx] = orig + h;
      const up = lossAndGrads(p, seq).loss;
      arr[idx] = orig - h;
      const down = lossAndGrads(p, seq).loss;
      arr[idx] = orig;
      expect(g[idx]).toBeCloseTo((up - down) / (2 * h), 5);
    };
    for (const idx of [0, 7, 20, 41, 55, p.W.length - 1]) check(p.W, grads.W, idx);
    for (const idx of [0, 5, 10, 15]) check(p.b, grads.b, idx);
    for (const idx of [0, 3]) check(p.v, grads.v, idx);
  });

  it('learns that the next answer usually follows the last one', () => {
    const rng = seededRng(4);
    // Sticky answers: 90% of the time the next answer repeats the last one.
    const seqs: Step[][] = Array.from({ length: 40 }, () => {
      const bits = [rng() > 0.5 ? 1 : 0];
      for (let t = 1; t < 10; t += 1) bits.push(rng() < 0.9 ? bits[t - 1] : 1 - bits[t - 1]);
      return bits.map((b, t) => ({ x: [b, 1 - b], target: t + 1 < bits.length ? bits[t + 1] : null }));
    });
    const p = initLstm({ input: 2, hidden: 4 }, 2);
    const losses = train(p, seqs, { epochs: 80 });
    expect(losses[losses.length - 1]).toBeLessThan(losses[0]);
    expect(predictSequence(p, [{ x: [1, 0], target: null }])[0]).toBeGreaterThan(0.75);
    expect(predictSequence(p, [{ x: [0, 1], target: null }])[0]).toBeLessThan(0.25);
  });
});
