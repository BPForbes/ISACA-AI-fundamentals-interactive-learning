import { describe, expect, it } from 'vitest';
import { CHAINS, DISTINCTIONS } from '../../data/chains';
import { TERMS } from '../../data/terms';
import {
  CONCEPTS, isOrthogonal, LIST_VERSION, neighbours, relation, relationTable,
  REL_ADJACENT_STEP, REL_DISTINCTION, REL_SAME_SECTION, REL_SAME_STEP,
} from '../relations';

describe('relation table', () => {
  it('covers every term once, symmetric, with 1 on the diagonal', () => {
    expect(CONCEPTS).toEqual(TERMS.map((t) => t.id));
    const n = CONCEPTS.length;
    const t = relationTable();
    expect(t.length).toBe(n * n);
    for (let i = 0; i < n; i += 1) {
      expect(t[i * n + i]).toBe(100);
      for (let j = i + 1; j < n; j += 7) expect(t[i * n + j]).toBe(t[j * n + i]);
    }
  });

  it('links terms of one chain step, distinctions, adjacent steps and sections', () => {
    const step = CHAINS.find((c) => c.id === 'metrics-to-business')!.steps[0];
    expect(relation(step.anchor, step.supporting[0])).toBeGreaterThanOrEqual(REL_SAME_STEP);
    for (const d of DISTINCTIONS) expect(relation(d.a, d.b)).toBeGreaterThanOrEqual(REL_DISTINCTION);
    const chain = CHAINS[0];
    expect(relation(chain.steps[0].anchor, chain.steps[1].anchor)).toBeGreaterThanOrEqual(REL_ADJACENT_STEP);
    const [a, b] = TERMS.filter((x) => x.section === TERMS[0].section);
    expect(relation(a.id, b.id)).toBeGreaterThanOrEqual(REL_SAME_SECTION);
  });

  it('calls unlinked terms orthogonal and unknown ids orthogonal to everything else', () => {
    const anchor = CHAINS[0].steps[0].anchor;
    const far = CONCEPTS.find((id) => relation(anchor, id) === 0)!;
    expect(far).toBeDefined();
    expect(isOrthogonal(anchor, far)).toBe(true);
    expect(relation('no-such-term', anchor)).toBe(0);
    expect(relation('no-such-term', 'no-such-term')).toBe(1);
  });

  it('lists neighbours strongest first and never the term itself', () => {
    const list = neighbours('precision');
    expect(list.map((n) => n.id)).not.toContain('precision');
    expect(list.map((n) => n.id)).toContain('recall');
    for (let k = 1; k < list.length; k += 1) expect(list[k - 1].weight).toBeGreaterThanOrEqual(list[k].weight);
  });

  it('has a 16-bit list version', () => {
    expect(Number.isInteger(LIST_VERSION)).toBe(true);
    expect(LIST_VERSION).toBeGreaterThanOrEqual(0);
    expect(LIST_VERSION).toBeLessThan(0x10000);
  });
});
