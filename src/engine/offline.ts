// Deterministic scene generator used when no language model is ready, or when a
// model's answer fails sanitizeScene. It builds scenes only from the term bank,
// the chains and the distinction table, so everything it asserts is exam wording.

import { contrastPartners, distinctionFor } from '../data/chains';
import { CHAPTERS, TERMS, TERM_BY_ID, type Term } from '../data/terms';
import type { SceneRequest } from './director';
import type { Choice, Scene } from './scene';
import { shuffleChoices } from './scene';

// Terms whose definitions overlap too much to serve as each other's distractors.
const SYNONYM_GROUPS: string[][] = [
  ['training', 'model-training', 'fitting', 'parameter-update'],
  ['ml', 'ml-approach', 'statistical-ai'],
  ['normalization-data', 'normalization-network', 'standardization'],
  ['ann', 'neural-network'],
  ['accuracy', 'model-accuracy-indicator'],
  ['sampling-bias', 'representation-bias', 'convenience-sampling', 'nonprobability-sampling'],
  ['rule-based', 'symbolic-ai'],
  ['generation', 'generative-ai'],
  ['classification', 'discriminative-ai'],
  ['data-lineage', 'provenance'],
  ['hitl', 'human-oversight', 'decision-support'],
  ['recall', 'tp'],
  ['kernel', 'convolution'],
  ['data-quality', 'data-quality-score'],
  ['ai', 'ani'],
];

const conflicts = (a: string, b: string) => a === b || SYNONYM_GROUPS.some((g) => g.includes(a) && g.includes(b));

const pick = <T,>(items: T[], rng: () => number): T => items[Math.floor(rng() * items.length)];

// Keeps acronyms such as "AI" or "TP" intact.
const lowerFirst = (s: string) => (/^[A-Z]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
const stripPeriod = (s: string) => s.replace(/\.$/, '');

/** Near-miss distractors first (contrast partners, same section), then the rest of the chapter. */
export const distractorsFor = (anchor: Term, count: number, rng: () => number, prefer: string[] = []): Term[] => {
  const chosen: Term[] = [];
  const add = (t: Term | undefined) => {
    if (!t || chosen.length >= count) return;
    if (conflicts(t.id, anchor.id) || chosen.some((c) => conflicts(c.id, t.id))) return;
    chosen.push(t);
  };
  for (const id of [...prefer, ...contrastPartners(anchor.id)]) add(TERM_BY_ID.get(id));
  const sameSection = TERMS.filter((t) => t.section === anchor.section && t.chapter === anchor.chapter);
  const sameChapter = TERMS.filter((t) => t.chapter === anchor.chapter);
  for (const pool of [sameSection, sameChapter, TERMS]) {
    const shuffled = [...pool].sort(() => rng() - 0.5);
    for (const t of shuffled) add(t);
  }
  return chosen;
};

const socraticFor = (req: SceneRequest): string => {
  switch (req.mode) {
    case 'contrast':
      return `What single clue separates ${req.anchor.term} from ${req.contrast?.partner.term ?? 'the closest alternative'}?`;
    case 'calculation':
      return 'Which group of cases did the question start from — predicted positives, actual positives, actual negatives, or all cases?';
    case 'integration':
      return `How does ${req.anchor.term} connect to the next link: ${req.chain.steps[req.stepIndex + 1]?.beat ?? req.chain.cue}`;
    case 'remediation':
    case 'explain':
      return `Explain ${req.anchor.term} in plain words, as if to someone new on the team.`;
    case 'maintenance':
      return 'Would the same term apply if this happened in a completely different industry? Why?';
    default:
      return 'What in the situation pointed you to that answer?';
  }
};

/** Whether text names a term by any of its forms: "Recall / Sensitivity", "Key Performance Indicator (KPI)". */
export const mentionsTerm = (text: string, term: Term): boolean => {
  const names = term.term.split(/\s*\/\s*|\s*\(|\)/).map((n) => n.trim()).filter((n) => n.length >= 2);
  const plain = names.map((n) => n.replace(/s$/, ''));
  return plain.some((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i').test(text));
};

const narrationFor = (req: SceneRequest, rng: () => number): string => {
  const speaker = pick(req.setting.cast, rng).split(',')[0];
  const lead = req.stepIndex === 0 && req.storySoFar.length === 0
    ? `${req.setting.name}. ${req.setting.premise}`
    : `Previously: ${req.storySoFar[req.storySoFar.length - 1] ?? req.chain.steps[req.stepIndex - 1]?.beat ?? ''}`;
  // A beat that names the anchor would give the answer away.
  const beat = mentionsTerm(req.step.beat, req.anchor)
    ? `Expedition beat — ${CHAPTERS[req.step.chapter].question}`
    : `Expedition beat — ${req.step.beat}`;
  return `${lead}\n\n${req.situation.moment} ${beat}\n\n${speaker} turns to you.`;
};

// Several ways to put the same exam-wording question, so consecutive template scenes
// do not read alike. Each keeps the definition verbatim.
const DESCRIBE_FRAMES: ((def: string) => string)[] = [
  (def) => `“Here's what we're dealing with: ${def}. What do we call that, so everyone means the same thing?”`,
  (def) => `“Strip away the noise and it comes down to this: ${def}. Which concept is that?”`,
  (def) => `“The write-up so far describes it as ${def}. What's the right term for the record?”`,
  (def) => `“If I had to put it in one line: ${def}. Name it, and we can move on.”`,
];

const NAME_FRAMES: ((term: string) => string)[] = [
  (term) => `“Everything here hinges on ${term}. Before we act, make sure we all mean the same thing.”`,
  (term) => `“Someone wrote ${term} on the whiteboard, and half the room reads it differently.”`,
  (term) => `“The decision we make in this room depends on ${term}. Which description is the right one?”`,
];

const termChoices = (req: SceneRequest, rng: () => number, correctText: (t: Term) => string): Choice[] => {
  const prefer = req.contrast ? [req.contrast.partner.id] : [];
  const distractors = distractorsFor(req.anchor, 3, rng, prefer);
  const right: Choice = {
    id: 'a',
    text: correctText(req.anchor),
    correct: true,
    consequence: `The team runs with ${req.anchor.term}, and it holds up: ${lowerFirst(req.step.beat)}`,
    explanation: `${req.anchor.term}: ${req.anchor.definition}`,
  };
  const wrong = distractors.map((t): Choice => {
    const clue = distinctionFor(req.anchor.id, t.id)?.clue;
    return {
      id: 'x',
      text: correctText(t),
      correct: false,
      consequence: `The team builds on ${t.term}, but it does not fit what was described, and the review stalls.`,
      explanation: `${t.term} means: ${t.definition}${clue ? ` Deciding clue: ${clue}` : ''}`,
    };
  });
  return shuffleChoices([right, ...wrong], rng);
};

const recognitionScene = (req: SceneRequest, rng: () => number): Scene => {
  // Early stages give the definition and ask for the term (scaffold); natural-use
  // stages give the term and ask which situation it describes.
  const scaffold = req.stage <= 2 || req.mode === 'explain' || req.mode === 'remediation' || req.mode === 'diagnostic';
  const narration = narrationFor(req, rng);
  if (scaffold) {
    return {
      narration: `${narration} ${pick(DESCRIBE_FRAMES, rng)(lowerFirst(stripPeriod(req.anchor.definition)))}`,
      prompt: 'Which concept is being described?',
      choices: termChoices(req, rng, (t) => t.term),
      socratic: socraticFor(req),
      source: 'offline',
    };
  }
  return {
    narration: `${narration} ${pick(NAME_FRAMES, rng)(req.anchor.term)}`,
    prompt: `Which statement captures ${req.anchor.term}?`,
    choices: termChoices(req, rng, (t) => t.definition),
    socratic: socraticFor(req),
    source: 'offline',
  };
};

const contrastScene = (req: SceneRequest, rng: () => number): Scene => {
  const partner = req.contrast?.partner;
  const narration = narrationFor(req, rng);
  const split = partner
    ? ` The team is split between ${req.anchor.term} and ${partner.term}.`
    : '';
  return {
    narration: `${narration}${split} “What we actually have here is this: ${lowerFirst(stripPeriod(req.anchor.definition))}. Which one is it?”`,
    prompt: 'Settle the argument: which concept fits?',
    choices: termChoices(req, rng, (t) => t.term),
    socratic: socraticFor(req),
    source: 'offline',
  };
};

// Confusion-matrix numbers are drawn so that every metric differs, which makes
// each distractor the result of using the wrong denominator.
type Matrix = { tp: number; fn: number; fp: number; tn: number };

const metricValues = (m: Matrix): Record<string, number> => ({
  precision: m.tp / (m.tp + m.fp),
  recall: m.tp / (m.tp + m.fn),
  specificity: m.tn / (m.tn + m.fp),
  accuracy: (m.tp + m.tn) / (m.tp + m.tn + m.fp + m.fn),
});

const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;

// Every metric differs here; used if the random draws keep colliding.
const FALLBACK_MATRIX: Matrix = { tp: 45, fn: 15, fp: 9, tn: 131 };

export const drawMatrix = (rng: () => number): Matrix => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const m = {
      tp: 20 + Math.floor(rng() * 60),
      fn: 5 + Math.floor(rng() * 30),
      fp: 5 + Math.floor(rng() * 30),
      tn: 60 + Math.floor(rng() * 120),
    };
    const vals = Object.values(metricValues(m)).map(pct);
    const counts = [m.tp, m.fn, m.fp, m.tn];
    if (new Set(vals).size === vals.length && new Set(counts).size === counts.length) return m;
  }
  return FALLBACK_MATRIX;
};

const calculationScene = (req: SceneRequest, rng: () => number): Scene => {
  const m = drawMatrix(rng);
  const actualPos = m.tp + m.fn;
  const actualNeg = m.fp + m.tn;
  const narration = `${narrationFor(req, rng)} “Pilot results are in. Of ${actualPos + actualNeg} cases, ${actualPos} were actually positive. The model flagged ${m.tp + m.fp} cases as positive, and ${m.tp} of those flags were right.”`;
  const vals = metricValues(m);
  const metricIds = ['precision', 'recall', 'specificity', 'accuracy'];
  const target = metricIds.includes(req.anchor.id) ? req.anchor.id : 'recall';

  if (['tp', 'fn', 'fp', 'tn', 'confusion-matrix'].includes(req.anchor.id)) {
    const cell = req.anchor.id === 'confusion-matrix' ? 'fn' : req.anchor.id;
    const cells: Record<string, string> = { tp: 'true positives', fn: 'false negatives', fp: 'false positives', tn: 'true negatives' };
    const choices = (['tp', 'fn', 'fp', 'tn'] as const).map((k): Choice => ({
      id: k,
      text: String(m[k]),
      correct: k === cell,
      consequence: k === cell
        ? `With the ${cells[cell]} counted correctly, the metric discussion can start on solid ground.`
        : 'The matrix is filled in wrong, and every metric built on it is off.',
      explanation: `TP=${m.tp}, FN=${m.fn} (actual positives ${actualPos} − TP), FP=${m.fp} (flags ${m.tp + m.fp} − TP), TN=${m.tn} (actual negatives ${actualNeg} − FP). ${TERM_BY_ID.get(cell)!.term}: ${TERM_BY_ID.get(cell)!.definition}`,
    }));
    return {
      narration,
      prompt: `Fill in the confusion matrix: how many ${cells[cell]}?`,
      choices: shuffleChoices(choices, rng),
      socratic: socraticFor(req),
      source: 'offline',
    };
  }

  const choices = metricIds.map((k): Choice => ({
    id: k,
    text: pct(vals[k]),
    correct: k === target,
    consequence: k === target
      ? `The ${TERM_BY_ID.get(target)!.term} figure goes in the report, and the team can now ask whether it is the right KPI.`
      : `That figure is ${TERM_BY_ID.get(k)!.term}, not ${TERM_BY_ID.get(target)!.term}; the report answers the wrong question.`,
    explanation: `${TERM_BY_ID.get(k)!.term} = ${TERM_BY_ID.get(k)!.definition.split(': ')[1] ?? ''} = ${pct(vals[k])}. Extract first: TP=${m.tp}, FN=${m.fn}, FP=${m.fp}, TN=${m.tn}.`,
  }));
  return {
    narration,
    prompt: `What is the model's ${TERM_BY_ID.get(target)!.term.split(' / ')[0].toLowerCase()}?`,
    choices: shuffleChoices(choices, rng),
    socratic: socraticFor(req),
    source: 'offline',
  };
};

export const generateOfflineScene = (req: SceneRequest, rng: () => number = Math.random): Scene => {
  if (req.mode === 'calculation') return calculationScene(req, rng);
  if (req.mode === 'contrast' && req.contrast) return contrastScene(req, rng);
  return recognitionScene(req, rng);
};

/**
 * Offline judging of a free-text field note: the share of the anchor
 * definition's content words the learner used. It is only a hint; the
 * definition is always shown alongside it.
 */
const STOP = new Set('a an the of to in and or for by with as is are be that which from into on its it this their than not only when such used use'.split(' '));

export const keywordOverlap = (answer: string, definition: string): number => {
  const words = (s: string) => s.toLowerCase().match(/[a-z]{3,}/g)?.filter((w) => !STOP.has(w)) ?? [];
  const target = new Set(words(definition).map((w) => w.slice(0, 5)));
  if (target.size === 0) return 0;
  const said = new Set(words(answer).map((w) => w.slice(0, 5)));
  let hit = 0;
  for (const w of target) if (said.has(w)) hit += 1;
  return hit / target.size;
};
