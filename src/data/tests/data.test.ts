import { describe, expect, it } from 'vitest';
import { CHAINS, DISTINCTIONS } from '../chains';
import { SETTINGS } from '../settings';
import { TERM_BY_ID, TERMS } from '../terms';

describe('study data', () => {
  it('has unique term ids', () => {
    expect(new Set(TERMS.map((t) => t.id)).size).toBe(TERMS.length);
  });

  it('only references known terms from chains, distinctions and settings', () => {
    const refs = [
      ...CHAINS.flatMap((c) => c.steps.flatMap((s) => [s.anchor, ...s.supporting])),
      ...DISTINCTIONS.flatMap((d) => [d.a, d.b]),
      ...SETTINGS.flatMap((s) => s.fits),
    ];
    expect(refs.filter((id) => !TERM_BY_ID.has(id))).toEqual([]);
  });

  it('covers all five chapters with the ten integration chains', () => {
    expect(CHAINS).toHaveLength(10);
    const chapters = new Set(CHAINS.flatMap((c) => c.steps.map((s) => s.chapter)));
    expect([...chapters].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
