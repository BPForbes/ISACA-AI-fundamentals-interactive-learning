import { describe, expect, it } from 'vitest';
import { clampRisk, scoreAnswer, streakMultiplier } from '../scoring';

describe('scoring', () => {
  it('matches the quickstart example: 10 × 2 × 1 × √3', () => {
    expect(scoreAnswer({ correct: true, risk: 2, mode: 'guided', streakBefore: 2 })).toEqual({ points: 35, streak: 3 });
  });

  it('uses the square root of the streak', () => {
    expect(streakMultiplier(4)).toBe(2);
    expect(streakMultiplier(0)).toBe(1);
  });

  it('breaks the streak on a miss and only charges stakes above 1×', () => {
    expect(scoreAnswer({ correct: false, risk: 1, mode: 'guided', streakBefore: 5 })).toEqual({ points: 0, streak: 0 });
    expect(scoreAnswer({ correct: false, risk: 0.5, mode: 'guided', streakBefore: 5 }).points).toBe(0);
    expect(scoreAnswer({ correct: false, risk: 3, mode: 'guided', streakBefore: 0 }).points).toBe(-20);
  });

  it('clamps risk to 0.25×–4×', () => {
    expect(clampRisk(10)).toBe(4);
    expect(clampRisk(0)).toBe(0.25);
    expect(clampRisk(Number.NaN)).toBe(1);
  });
});
