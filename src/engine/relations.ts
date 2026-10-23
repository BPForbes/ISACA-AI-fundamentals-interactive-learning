// Concept relation table: one weight in [0, 1] for every pair of terms, read by
// the attention tracker (attention.ts) as its keys. It is built from the guide's
// own structure, never from model output:
//   1    the same term
//   0.8  anchor and supporting terms of one chain step (explained together)
//   0.7  a "do not confuse" pair (DISTINCTIONS)
//   0.5  terms of adjacent steps in a chain (one leads into the next)
//   0.4  the same chapter section
//   0    orthogonal: no link in the guide, so evidence on one says nothing about the other

import { CHAINS, DISTINCTIONS } from '../data/chains';
import { TERMS } from '../data/terms';

export const CONCEPTS: readonly string[] = TERMS.map((t) => t.id);
export const CONCEPT_INDEX: ReadonlyMap<string, number> = new Map(CONCEPTS.map((id, i) => [id, i]));

export const REL_SAME_STEP = 0.8;
export const REL_DISTINCTION = 0.7;
export const REL_ADJACENT_STEP = 0.5;
export const REL_SAME_SECTION = 0.4;

/**
 * FNV-1a of the concept order, cut to 16 bits. A packed mastery matrix carries it,
 * so a matrix saved under another term list is never read against this one.
 */
export const LIST_VERSION = (() => {
  let h = 0x811c9dc5;
  for (const ch of CONCEPTS.join('\n')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 16) ^ h) & 0xffff;
})();

// Weights are stored as hundredths in one byte, so they compare exactly.
let table: Uint8Array | null = null;

const build = (): Uint8Array => {
  const n = CONCEPTS.length;
  const t = new Uint8Array(n * n);
  const link = (a: string, b: string, weight: number) => {
    const w = Math.round(weight * 100);
    const i = CONCEPT_INDEX.get(a);
    const j = CONCEPT_INDEX.get(b);
    if (i === undefined || j === undefined) return;
    if (t[i * n + j] < w) t[i * n + j] = w;
    if (t[j * n + i] < w) t[j * n + i] = w;
  };
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (TERMS[i].chapter === TERMS[j].chapter && TERMS[i].section === TERMS[j].section) link(CONCEPTS[i], CONCEPTS[j], REL_SAME_SECTION);
    }
  }
  for (const chain of CHAINS) {
    const groups = chain.steps.map((s) => [s.anchor, ...s.supporting]);
    groups.forEach((group, k) => {
      for (const a of group) for (const b of group) if (a !== b) link(a, b, REL_SAME_STEP);
      if (k > 0) for (const a of groups[k - 1]) for (const b of group) if (a !== b) link(a, b, REL_ADJACENT_STEP);
    });
  }
  for (const d of DISTINCTIONS) link(d.a, d.b, REL_DISTINCTION);
  for (let i = 0; i < n; i += 1) t[i * n + i] = 100;
  return t;
};

export const relationTable = (): Uint8Array => (table ??= build());

/** Relation weight between two terms; unknown ids are orthogonal to everything but themselves. */
export const relation = (a: string, b: string): number => {
  if (a === b) return 1;
  const i = CONCEPT_INDEX.get(a);
  const j = CONCEPT_INDEX.get(b);
  return i === undefined || j === undefined ? 0 : relationTable()[i * CONCEPTS.length + j] / 100;
};

export const isOrthogonal = (a: string, b: string): boolean => relation(a, b) === 0;

/** Terms linked to `id`, strongest first, excluding the term itself. */
export const neighbours = (id: string, min = REL_SAME_SECTION): { id: string; weight: number }[] => {
  const i = CONCEPT_INDEX.get(id);
  if (i === undefined) return [];
  const row = relationTable().subarray(i * CONCEPTS.length, (i + 1) * CONCEPTS.length);
  const out: { id: string; weight: number }[] = [];
  row.forEach((w, j) => {
    if (j !== i && w / 100 >= min) out.push({ id: CONCEPTS[j], weight: w / 100 });
  });
  return out.sort((x, y) => y.weight - x.weight || x.id.localeCompare(y.id));
};
