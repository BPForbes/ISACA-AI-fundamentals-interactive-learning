// One entry point for "write the next scene" and "judge this explanation".
// Every model answer goes through sanitizeScene; any failure, timeout or
// missing backend falls back to the offline generator so play never stalls.

import type { SceneRequest } from '../engine/director';
import { generateOfflineScene, keywordOverlap } from '../engine/offline';
import { judgeRules, parseCritic } from '../engine/discriminator';
import { extractJson, sanitizeScene, shuffleChoices, type Scene, type SceneReview } from '../engine/scene';
import { completeWithCloud, isCloudConfigured, type CloudConfig } from '../sync/cloud';
import type { LlmSettings } from './config';
import { completeWithHosted, isHostedConfigured, type HostedConfig } from './hosted';
import { completeWithOllama } from './ollama';
import { buildCriticPrompt, buildNotePrompt, buildScenePrompt } from './prompt';
import { completeWithWebLlm, isBrowserModelReady } from './webllm';

export type Backend = 'hosted' | 'browser' | 'ollama' | 'cloud' | 'offline';

export type Backends = { cloud: CloudConfig; hosted: HostedConfig };

/** "auto" prefers a free hosted model, then a browser model loaded this session, and Cloudflare last. */
export const activeBackend = (s: LlmSettings, b: Backends): Backend => {
  if (s.mode === 'auto') {
    if (isHostedConfigured(b.hosted)) return 'hosted';
    if (isBrowserModelReady(s.browserModel)) return 'browser';
    if (isCloudConfigured(b.cloud)) return 'cloud';
    return 'offline';
  }
  return s.mode;
};

const complete = async (backend: Backend, s: LlmSettings, b: Backends, system: string, user: string, maxTokens: number) => {
  switch (backend) {
    case 'hosted':
      return completeWithHosted(b.hosted, system, user, maxTokens);
    case 'browser':
      return completeWithWebLlm(s.browserModel, system, user, maxTokens);
    case 'ollama':
      return completeWithOllama(s.ollamaUrl, s.ollamaModel, system, user);
    case 'cloud':
      return completeWithCloud(b.cloud, system, user, maxTokens);
    default:
      return null;
  }
};

export type SceneResult = { scene: Scene; fallbackReason?: string };

/**
 * GAN-inspired generate-and-discriminate loop. The offline template is the
 * "real" sample: the generator rewrites it into a richer scene, the
 * discriminator grades the draft against the template and the exam definition
 * (rules, then optionally a blind AI critic), and rejected drafts go back with
 * the reasons. After the last round the template itself is used.
 */
export const generateScene = async (
  req: SceneRequest,
  s: LlmSettings,
  b: Backends,
  rng: () => number = Math.random,
): Promise<SceneResult> => {
  const template = generateOfflineScene(req, rng);
  const backend = activeBackend(s, b);
  // Calculation scenes need exact arithmetic, which small models get wrong.
  if (backend === 'offline' || req.mode === 'calculation') return { scene: template };

  let feedback: string[] = [];
  let lastIssues: string[] = [];
  for (let round = 1; round <= s.rounds; round += 1) {
    let candidate: Scene | null = null;
    try {
      const { system, user } = buildScenePrompt(req, template, feedback);
      const content = await complete(backend, s, b, system, user, 900);
      const sane = content ? sanitizeScene(extractJson(content)) : null;
      candidate = sane ? { ...sane, choices: shuffleChoices(sane.choices, rng), source: 'ai' } : null;
    } catch (error) {
      return { scene: template, fallbackReason: error instanceof Error ? error.message : 'The model is unavailable.' };
    }
    if (!candidate) {
      feedback = ['The output was not valid JSON with 3-4 distinct choices and exactly one correct.'];
      lastIssues = feedback;
      continue;
    }

    const rules = judgeRules(candidate, req, template);
    if (!rules.pass) {
      feedback = rules.issues;
      lastIssues = rules.issues;
      continue;
    }

    let critic: SceneReview['critic'] = 'skipped';
    if (s.discriminator === 'rules+ai') {
      try {
        const { system, user } = buildCriticPrompt(req, candidate);
        const content = await complete(backend, s, b, system, user, 300);
        const verdict = content ? parseCritic(extractJson(content), candidate.choices.map((c) => c.id)) : null;
        const keyed = candidate.choices.find((c) => c.correct)!.id;
        if (!verdict) critic = 'unavailable';
        else if (verdict.answer !== keyed || verdict.contradicts) {
          feedback = [
            verdict.answer !== keyed
              ? `A reviewer answering blind chose "${candidate.choices.find((c) => c.id === verdict.answer)?.text}" instead of the keyed answer. Make the situation point unambiguously to ${req.anchor.term}.`
              : 'A reviewer found a contradiction with the exam definition.',
            ...verdict.issues,
          ];
          lastIssues = feedback;
          continue;
        } else critic = 'agreed';
      } catch {
        critic = 'unavailable';
      }
    }
    return { scene: { ...candidate, review: { rounds: round, score: rules.score, critic, rejected: round - 1 } } };
  }
  return {
    scene: { ...template, review: { rounds: s.rounds, score: 0, critic: 'skipped', rejected: s.rounds } },
    fallbackReason: `The discriminator rejected ${s.rounds} AI drafts, so the template scene is used. Last reason: ${lastIssues[0] ?? 'unknown'}`,
  };
};

export type NoteVerdict = { verdict: 'solid' | 'partial' | 'off'; feedback: string; source: 'ai' | 'offline' };

const offlineVerdict = (req: SceneRequest, note: string): NoteVerdict => {
  const overlap = keywordOverlap(note, req.anchor.definition);
  const verdict = overlap >= 0.4 ? 'solid' : overlap >= 0.2 ? 'partial' : 'off';
  const lead = verdict === 'solid'
    ? 'That lines up with the exam wording.'
    : verdict === 'partial'
      ? 'Part of that is there. Compare it with the exam wording:'
      : "That doesn't quite capture it yet. Here's the exam wording:";
  return { verdict, feedback: `${lead} ${req.anchor.term}: ${req.anchor.definition}`, source: 'offline' };
};

export const evaluateNote = async (
  req: SceneRequest,
  choiceText: string,
  note: string,
  s: LlmSettings,
  b: Backends,
): Promise<NoteVerdict> => {
  const backend = activeBackend(s, b);
  if (backend === 'offline') return offlineVerdict(req, note);
  try {
    const { system, user } = buildNotePrompt(req, choiceText, note);
    const content = await complete(backend, s, b, system, user, 300);
    const raw = content ? (extractJson(content) as Record<string, unknown> | null) : null;
    const verdict = raw?.verdict;
    const feedback = typeof raw?.feedback === 'string' ? raw.feedback.trim().slice(0, 800) : '';
    if ((verdict === 'solid' || verdict === 'partial' || verdict === 'off') && feedback) {
      return { verdict, feedback, source: 'ai' };
    }
  } catch {
    // Fall through to the offline verdict.
  }
  return offlineVerdict(req, note);
};
