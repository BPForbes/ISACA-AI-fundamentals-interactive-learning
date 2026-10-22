import { describe, expect, it } from 'vitest';
import { extractJson, sanitizeScene, shuffleChoices } from '../scene';

const valid = {
  narration: 'The board meets.',
  prompt: 'What now?',
  choices: [
    { text: 'A', correct: true, consequence: 'good', explanation: 'yes' },
    { text: 'B', correct: false, consequence: 'bad', explanation: 'no' },
    { text: 'C', correct: 'false', consequence: 'bad', explanation: 'no' },
  ],
  socratic: 'Why?',
};

describe('sanitizeScene', () => {
  it('accepts a scene with exactly one correct choice', () => {
    const scene = sanitizeScene(valid)!;
    expect(scene.choices.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(scene.choices.filter((c) => c.correct)).toHaveLength(1);
  });

  it('rejects zero or two correct answers, too few or duplicate choices', () => {
    expect(sanitizeScene({ ...valid, choices: valid.choices.map((c) => ({ ...c, correct: true })) })).toBeNull();
    expect(sanitizeScene({ ...valid, choices: valid.choices.map((c) => ({ ...c, correct: false })) })).toBeNull();
    expect(sanitizeScene({ ...valid, choices: valid.choices.slice(0, 2) })).toBeNull();
    expect(sanitizeScene({ ...valid, choices: [valid.choices[0], { ...valid.choices[1], text: 'a' }, valid.choices[2]] })).toBeNull();
    expect(sanitizeScene('nope')).toBeNull();
  });

  it('strips control characters and caps lengths', () => {
    const scene = sanitizeScene({ ...valid, narration: `x\u0007${'y'.repeat(5000)}` })!;
    expect(scene.narration.startsWith('xy')).toBe(true);
    expect(scene.narration.length).toBe(1200);
  });

  it('extracts JSON wrapped in prose or code fences', () => {
    expect(extractJson('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('no json')).toBeNull();
  });

  it('shuffles without losing the correct choice', () => {
    const shuffled = shuffleChoices(sanitizeScene(valid)!.choices, () => 0);
    expect(shuffled.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(shuffled.find((c) => c.correct)!.text).toBe('A');
  });
});
