// Bit-packed mastery matrix, the form the matrix takes in a save. Updates run on the
// full-precision matrix in memory (attention.ts); only a save packs it, because
// small nudges to related concepts would round away at this precision.
//
// Layout:
//   [0]                  format version (1)
//   [1, 3)               LIST_VERSION of the concept order, big-endian
//   [3, 3 + ceil(C/8))   bitmap: bit i of byte i>>3 is set when concept i has an entry
//   then, per set bit    uint16 big-endian: p in the top 12 bits, an evidence bucket in the low 4

import type { MasteryMatrix } from './attention';
import { CONCEPTS, LIST_VERSION } from './relations';

export const MATRIX_FORMAT = 1;

// Lower bounds of the 16 evidence buckets.
export const EVIDENCE_BUCKETS = [0, 0.25, 0.5, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 64, 128];

export const packedSize = (concepts: number, entries: number) => 3 + Math.ceil(concepts / 8) + 2 * entries;

export const packMatrix = (matrix: MasteryMatrix): Uint8Array => {
  const touched = CONCEPTS.map((id, i) => [i, matrix.get(id)] as const).filter((x) => x[1] !== undefined);
  const bitmap = Math.ceil(CONCEPTS.length / 8);
  const buf = new Uint8Array(packedSize(CONCEPTS.length, touched.length));
  const view = new DataView(buf.buffer);
  view.setUint8(0, MATRIX_FORMAT);
  view.setUint16(1, LIST_VERSION);
  let off = 3 + bitmap;
  for (const [i, e] of touched) {
    buf[3 + (i >> 3)] |= 1 << (i & 7);
    const q = Math.round(Math.min(1, Math.max(0, e!.p)) * 4095);
    let bucket = 0;
    while (bucket < 15 && EVIDENCE_BUCKETS[bucket + 1] <= e!.evidence) bucket += 1;
    view.setUint16(off, (q << 4) | bucket);
    off += 2;
  }
  return buf;
};

export type UnpackedEntry = { p: number; evidenceAtLeast: number };

/** Decodes a matrix packed under this concept order; anything else is null. */
export const unpackMatrix = (buf: Uint8Array): Map<string, UnpackedEntry> | null => {
  const bitmap = Math.ceil(CONCEPTS.length / 8);
  if (buf.length < 3 + bitmap) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (view.getUint8(0) !== MATRIX_FORMAT || view.getUint16(1) !== LIST_VERSION) return null;
  let set = 0;
  for (let i = 0; i < CONCEPTS.length; i += 1) if (buf[3 + (i >> 3)] & (1 << (i & 7))) set += 1;
  if (buf.length !== packedSize(CONCEPTS.length, set)) return null;
  const out = new Map<string, UnpackedEntry>();
  let off = 3 + bitmap;
  CONCEPTS.forEach((id, i) => {
    if (!(buf[3 + (i >> 3)] & (1 << (i & 7)))) return;
    const v = view.getUint16(off);
    off += 2;
    out.set(id, { p: (v >> 4) / 4095, evidenceAtLeast: EVIDENCE_BUCKETS[v & 15] });
  });
  return out;
};

// A save is JSON, so the bytes travel as base64.
export const toBase64 = (buf: Uint8Array): string => {
  let s = '';
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s);
};

export const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));
