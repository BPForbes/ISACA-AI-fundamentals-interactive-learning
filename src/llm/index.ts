// One entry point for "write the next scene" and "judge this explanation".
// Every model answer goes through sanitizeScene; any failure, timeout or
// missing backend falls back to the offline generator so play never stalls.

import type { SceneRequest } from '../engine/director';
import { generateOfflineScene, keywordOverlap } from '../engine/offline';
import { extractJson, sanitizeScene, shuffleChoices, type Scene } from '../engine/scene';
import { completeWithCloud, isCloudConfigured, type CloudConfig } from '../sync/cloud';
import type { LlmSettings } from './config';
import { completeWithOllama } from './ollama';
import { buildNotePrompt, buildScenePrompt } from './prompt';
import { completeWithWebLlm, isBrowserModelReady } from './webllm';

export type Backend = 'browser' | 'ollama' | 'cloud' | 'offline';

/** "auto" prefers a browser model already loaded this session, then the cloud model. */
export const activeBackend = (s: LlmSettings, cloud: CloudConfig): Backend => {
  if (s.mode === 'auto') {
    if (isBrowserModelReady(s.browserModel)) return 'browser';
    if (isCloudConfigured(cloud)) return 'cloud';
    return 'offline';
  }
  return s.mode;
};

const complete = async (backend: Backend, s: LlmSettings, cloud: CloudConfig, system: string, user: string, maxTokens: number) => {
  switch (backend) {
    case 'browser':
      return completeWithWebLlm(s.browserModel, system, user, maxTokens);
    case 'ollama':
      return completeWithOllama(s.ollamaUrl, s.ollamaModel, system, user);
    case 'cloud':
      return completeWithCloud(cloud, system, user, maxTokens);
    default:
      return null;
  }
};

export type SceneResult = { scene: Scene; fallbackReason?: string };

export const generateScene = async (
  req: SceneRequest,
  s: LlmSettings,
  cloud: CloudConfig,
  rng: () => number = Math.random,
): Promise<SceneResult> => {
  const backend = activeBackend(s, cloud);
  // Calculation scenes need exact arithmetic, which small models get wrong.
  if (backend === 'offline' || req.mode === 'calculation') return { scene: generateOfflineScene(req, rng) };
  try {
    const { system, user } = buildScenePrompt(req);
    const content = await complete(backend, s, cloud, system, user, 900);
    const scene = content ? sanitizeScene(extractJson(content)) : null;
    if (scene) return { scene: { ...scene, choices: shuffleChoices(scene.choices, rng), source: 'ai' } };
    return { scene: generateOfflineScene(req, rng), fallbackReason: 'The model answer was not a valid scene.' };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'The model is unavailable.';
    return { scene: generateOfflineScene(req, rng), fallbackReason: reason };
  }
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
  cloud: CloudConfig,
): Promise<NoteVerdict> => {
  const backend = activeBackend(s, cloud);
  if (backend === 'offline') return offlineVerdict(req, note);
  try {
    const { system, user } = buildNotePrompt(req, choiceText, note);
    const content = await complete(backend, s, cloud, system, user, 300);
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
