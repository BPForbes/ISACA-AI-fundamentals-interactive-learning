// The lab's data: a fictional population of cases with two features, a label,
// and a group (a minority of cases that live in a different part of the space
// and follow a slightly different rule). How the sample is drawn, corrupted and
// cleaned is what the data-stage challenges are about. Everything is seeded, so
// the same configuration always gives the same dataset.

import { seededRng } from '../lstm';

export type Point = { x: number; y: number; label: 0 | 1; group: 0 | 1 };

export type Sampling = 'convenience' | 'random' | 'stratified';

type Row = Point & { noisy?: boolean };

export type DataConfig = {
  seed: number;
  sampling: Sampling;
  sampleSize: number;
  // Share of the sample that is duplicated rows.
  duplicates: number;
  // Far-off rows added to the sample.
  outliers: number;
  // Share of sample labels that are wrong.
  labelNoise: number;
  // Remedies: drop duplicates and far-off rows; re-check labels against the source;
  // add jittered copies of each training row.
  cleanse: boolean;
  verifyLabels: boolean;
  augment: boolean;
  // The world has moved: the test set follows a boundary shifted along x by this much,
  // and `recent` draws the sample from that shifted world too.
  drift: number;
  recent: boolean;
  // How much the world's boundary bends; a straight line fits it less the higher this is.
  curvature: number;
};

export type Dataset = {
  population: Point[];
  sample: Point[];
  train: Point[];
  validation: Point[];
  test: Point[];
  // Share of the minority group in the population and in the sample.
  groupShare: { population: number; sample: number };
  // Rows the cleanse removed and labels the check corrected.
  removed: number;
  corrected: number;
};

export const POPULATION = 360;
export const MINORITY_SHARE = 0.3;
export const VALIDATION_SIZE = 100;
export const TEST_SIZE = 100;
const LABEL_NOISE_SD = 0.35;

export const defaultData = (seed: number): DataConfig => ({
  seed, sampling: 'random', sampleSize: 120, duplicates: 0, outliers: 0, labelNoise: 0,
  cleanse: false, verifyLabels: false, augment: false, drift: 0, recent: false, curvature: 1.6,
});

/** The world's rule: a curved boundary, moved for the minority group and by drift. */
export const trueScore = (x: number, y: number, group: 0 | 1, drift = 0, curvature = 1.6): number => {
  const xs = x - drift;
  return 1.4 * xs + 1.1 * y - curvature * xs * y + (group === 1 ? 0.9 : 0);
};

const gaussian = (rng: () => number) => {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

const draw = (rng: () => number, n: number, drift: number, curvature: number): Point[] =>
  Array.from({ length: n }, () => {
    const group: 0 | 1 = rng() < MINORITY_SHARE ? 1 : 0;
    const x = group === 1 ? -1 + rng() * 0.9 : -0.6 + rng() * 1.6;
    const y = -1 + rng() * 2;
    const label: 0 | 1 = trueScore(x, y, group, drift, curvature) + gaussian(rng) * LABEL_NOISE_SD > 0 ? 1 : 0;
    return { x, y, label, group };
  });

const shuffle = <T,>(items: T[], rng: () => number): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

const sampleFrom = (population: Point[], cfg: DataConfig, rng: () => number): Point[] => {
  const n = Math.min(cfg.sampleSize, population.length);
  switch (cfg.sampling) {
    case 'convenience': {
      // The cases nearest the office: ranked by distance from (0.6, 0), which is where the majority lives.
      return [...population].sort((a, b) => Math.hypot(a.x - 0.6, a.y) - Math.hypot(b.x - 0.6, b.y)).slice(0, n);
    }
    case 'stratified': {
      const minority = shuffle(population.filter((p) => p.group === 1), rng);
      const majority = shuffle(population.filter((p) => p.group === 0), rng);
      const k = Math.round(n * (minority.length / population.length));
      return shuffle([...minority.slice(0, k), ...majority.slice(0, n - k)], rng);
    }
    default:
      return shuffle(population, rng).slice(0, n);
  }
};

const isFarOff = (p: Point) => Math.abs(p.x) > 1.5 || Math.abs(p.y) > 1.5;

export const buildDataset = (cfg: DataConfig): Dataset => {
  const rng = seededRng(cfg.seed);
  const population = draw(rng, POPULATION, 0, cfg.curvature);
  const world = cfg.recent ? draw(rng, POPULATION, cfg.drift, cfg.curvature) : population;
  let sample = sampleFrom(world, cfg, rng);
  const sampled = new Set(sample);

  // Corruption: what the source handed over.
  const dupes = Math.round(sample.length * cfg.duplicates);
  sample = [...sample, ...sample.slice(0, dupes).map((p) => ({ ...p }))];
  // Readings no instrument could have produced, past the right edge, all labelled negative where the world is positive.
  for (let i = 0; i < cfg.outliers; i += 1) {
    sample.push({ x: 1.6 + rng() * 0.8, y: -1 + rng() * 2, label: 0, group: 0 });
  }
  // Wrong labels: a random share of rows, remembered so a label check can put them right.
  const flips = Math.round(sample.length * cfg.labelNoise);
  const rows: Row[] = shuffle(sample, rng).map((p, i) => (i < flips ? { ...p, label: p.label === 1 ? 0 : 1, noisy: true } : { ...p }));

  // Remedies.
  let removed = 0;
  let corrected = 0;
  let train: Row[] = rows;
  if (cfg.cleanse) {
    const seen = new Set<string>();
    train = train.filter((p) => {
      const key = `${p.x.toFixed(6)},${p.y.toFixed(6)}`;
      const keep = !isFarOff(p) && !seen.has(key);
      seen.add(key);
      if (!keep) removed += 1;
      return keep;
    });
  }
  if (cfg.verifyLabels) {
    train = train.map((p) => {
      if (!p.noisy) return p;
      corrected += 1;
      return { x: p.x, y: p.y, group: p.group, label: p.label === 1 ? 0 : 1 };
    });
  }
  if (cfg.augment) {
    train = [...train, ...train.map((p) => ({ ...p, x: p.x + gaussian(rng) * 0.05, y: p.y + gaussian(rng) * 0.05 }))];
  }

  // Held-out sets are drawn from the world as it is, never from the sample.
  const rest = shuffle(population.filter((p) => !sampled.has(p)), rng);
  const validation = rest.slice(0, VALIDATION_SIZE);
  const test = draw(rng, TEST_SIZE, cfg.drift, cfg.curvature);
  const share = (points: Point[]) => (points.length ? points.filter((p) => p.group === 1).length / points.length : 0);
  const strip = (p: Row): Point => ({ x: p.x, y: p.y, label: p.label, group: p.group });
  return {
    population, sample: rows.map(strip), train: train.map(strip), validation, test,
    groupShare: { population: share(population), sample: share(rows) }, removed, corrected,
  };
};
