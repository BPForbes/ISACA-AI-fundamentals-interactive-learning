// The discriminator half of the GAN-inspired scene loop. The template scene
// (built by the offline generator from the term bank) is the "real" sample;
// the language model's scene is the candidate. Unlike a GAN, nothing here is
// trained: the discriminator is fixed rules plus, optionally, a second model
// call, and its verdict is fed back to the generator as written feedback.

import { TERMS, type Term } from '../data/terms';
import type { SceneRequest } from './director';
import { keywordOverlap, mentionsTerm } from './offline';
import type { Choice, Scene } from './scene';

export type Check = { name: string; ok: boolean; hard: boolean; detail: string };

export type RuleVerdict = { pass: boolean; score: number; checks: Check[]; issues: string[] };

type Candidate = Omit<Scene, 'source' | 'review'>;

/** Whether the scene may use the anchor's name, mirroring the generator prompt. */
export const namesAllowed = (req: SceneRequest) => req.stage >= 3 && req.stage !== 5;

const grounded = (text: string, term: Term) => mentionsTerm(text, term) || keywordOverlap(text, term.definition) >= 0.3;

/** The bank term a choice most plausibly stands for, if any. */
export const matchTerm = (choice: Choice): Term | undefined =>
  TERMS.find((t) => mentionsTerm(choice.text, t)) ?? TERMS.find((t) => keywordOverlap(choice.text, t.definition) >= 0.45);

export const judgeRules = (candidate: Candidate, req: SceneRequest, template: Scene): RuleVerdict => {
  const right = candidate.choices.find((c) => c.correct)!;
  const wrong = candidate.choices.filter((c) => !c.correct);
  const story = `${candidate.narration} ${candidate.prompt}`;
  const checks: Check[] = [];

  checks.push({
    name: 'answer key',
    hard: true,
    ok: grounded(`${right.text} ${right.explanation}`, req.anchor),
    detail: `The correct choice and its explanation must express ${req.anchor.term} as defined: "${req.anchor.definition}"`,
  });
  if (!namesAllowed(req)) {
    checks.push({
      name: 'no giveaway',
      hard: true,
      ok: !mentionsTerm(story, req.anchor),
      detail: `The narration and prompt must not name ${req.anchor.term}; describe the situation instead.`,
    });
  }
  const ambiguous = wrong.filter((c) => mentionsTerm(c.text, req.anchor));
  checks.push({
    name: 'single right answer',
    hard: true,
    ok: ambiguous.length === 0,
    detail: `Wrong choices must not also be ${req.anchor.term}: ${ambiguous.map((c) => `"${c.text}"`).join(', ') || 'none'}.`,
  });

  // Soft checks compare the candidate with what the template shows good scenes look like.
  const templateTerms = new Set(template.choices.filter((c) => !c.correct).map(matchTerm).filter(Boolean).map((t) => t!.id));
  const mapped = wrong.map(matchTerm);
  const nearMisses = mapped.filter((t) => t && t.id !== req.anchor.id).length;
  checks.push({
    name: 'near-miss distractors',
    hard: false,
    ok: nearMisses >= Math.ceil(wrong.length / 2),
    detail: `Wrong choices should be real course concepts a learner could confuse with the anchor (the template used: ${[...templateTerms].join(', ') || 'calculations'}).`,
  });
  checks.push({
    name: 'explanations',
    hard: false,
    ok: candidate.choices.every((c) => c.explanation.length >= 20 && c.consequence.length >= 15),
    detail: 'Every choice needs an explanation in exam wording and a story consequence.',
  });
  checks.push({
    name: 'story length',
    hard: false,
    ok: candidate.narration.length >= 80,
    detail: 'The narration should set the scene in at least two sentences.',
  });
  const linked = [...req.supporting, ...(req.contrast ? [req.contrast.partner] : []), ...(req.bridge ? [req.bridge] : [])];
  if (linked.length > 0) {
    checks.push({
      name: 'chain context',
      hard: false,
      ok: linked.some((t) => mentionsTerm(`${story} ${candidate.choices.map((c) => `${c.text} ${c.explanation}`).join(' ')}`, t)),
      detail: `Use at least one connected concept to explain the anchor: ${linked.map((t) => t.term).join(', ')}.`,
    });
  }

  const soft = checks.filter((c) => !c.hard);
  const score = soft.length ? soft.filter((c) => c.ok).length / soft.length : 1;
  const hardOk = checks.filter((c) => c.hard).every((c) => c.ok);
  const pass = hardOk && score >= 0.5;
  return { pass, score, checks, issues: checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`) };
};

export type CriticVerdict = { answer: string | null; contradicts: boolean; issues: string[] };

/** Parses the critic model's JSON; anything unusable is null so the caller can skip it. */
export const parseCritic = (raw: unknown, choiceIds: string[]): CriticVerdict | null => {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const answer = typeof r.answer === 'string' ? r.answer.trim().toLowerCase().slice(0, 1) : null;
  if (!answer || !choiceIds.includes(answer)) return null;
  const contradicts = r.contradicts_definition === true || r.contradicts_definition === 'true';
  const issues = Array.isArray(r.issues) ? r.issues.filter((i): i is string => typeof i === 'string').map((i) => i.slice(0, 300)).slice(0, 5) : [];
  return { answer, contradicts, issues };
};
