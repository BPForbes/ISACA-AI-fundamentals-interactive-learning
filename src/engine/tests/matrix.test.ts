import { describe, expect, it } from 'vitest';
import type { MasteryMatrix } from '../attention';
import { fromBase64, packedSize, packMatrix, toBase64, unpackMatrix } from '../matrix';
import { CONCEPTS } from '../relations';

const matrix: MasteryMatrix = new Map([
  ['precision', { p: 0.9, ownP: 0.9, evidence: 5, attempts: 5, state: 'mastered', lastAt: null }],
  ['recall', { p: 0.31, ownP: 0.31, evidence: 0.6, attempts: 2, state: 'struggling', lastAt: null }],
  ['kpi', { p: 1.2, ownP: 1.2, evidence: 999, attempts: 9, state: 'mastered', lastAt: null }],
]);

describe('packed mastery matrix', () => {
  it('round-trips at 12-bit precision with an evidence floor', () => {
    const bytes = packMatrix(matrix);
    expect(bytes.length).toBe(packedSize(CONCEPTS.length, 3));
    const back = unpackMatrix(bytes)!;
    expect([...back.keys()].sort()).toEqual(['kpi', 'precision', 'recall']);
    expect(back.get('precision')!.p).toBeCloseTo(0.9, 3);
    expect(back.get('recall')!.p).toBeCloseTo(0.31, 3);
    expect(back.get('kpi')!.p).toBe(1);
    expect(back.get('precision')!.evidenceAtLeast).toBe(4);
    expect(back.get('recall')!.evidenceAtLeast).toBe(0.5);
    expect(back.get('kpi')!.evidenceAtLeast).toBe(128);
  });

  it('survives base64 and refuses another format, list or length', () => {
    const bytes = packMatrix(matrix);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    const wrongFormat = bytes.slice();
    wrongFormat[0] = 2;
    expect(unpackMatrix(wrongFormat)).toBeNull();
    const wrongList = bytes.slice();
    wrongList[1] ^= 0xff;
    expect(unpackMatrix(wrongList)).toBeNull();
    expect(unpackMatrix(bytes.slice(0, -1))).toBeNull();
  });

  it('stays small: an empty matrix is the header and bitmap', () => {
    expect(packMatrix(new Map()).length).toBe(3 + Math.ceil(CONCEPTS.length / 8));
  });
});
