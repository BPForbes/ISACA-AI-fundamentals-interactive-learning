// Prompts shared by every backend. The model writes the story; the term bank
// supplies the exam wording it must stay faithful to. Its output is JSON that
// sanitizeScene validates before anything reaches the game.

import { CHAPTERS } from '../data/terms';
import type { SceneRequest } from '../engine/director';
import { STAGE_NAMES } from '../engine/progress';
import { MODE_LABELS, type Scene } from '../engine/scene';

const MODE_GUIDANCE: Record<string, string> = {
  diagnostic: 'Probe whether the learner recognizes the concept in a realistic situation. Keep it approachable.',
  explain: 'Teach the concept inside the narration in plain language first, then ask them to apply it.',
  guided: 'Give a clear clue in the situation that points to the concept, without naming it.',
  contrast: 'Build a near-miss: the closest confusing concept must be a tempting wrong choice, and the situation must contain the deciding clue.',
  calculation: 'Give concrete counts (TP, FN, FP, TN derivable from the story) and ask for one metric; wrong choices are the other metrics computed from the same counts.',
  integration: 'Use the formal term naturally, without defining it, and make the decision depend on how it connects to the neighbouring link of the chain.',
  remediation: 'The learner missed this recently. Simplify: one plain-language situation, a familiar analogy, and the formal term reconnected to it.',
  maintenance: 'The learner is strong here. Make it a harder, exam-style scenario with plausible distractors.',
};

export const SCENE_SCHEMA = `{
  "narration": string,   // 2-5 sentences of story, second person, continuing the story so far
  "prompt": string,      // the decision the learner must make, one sentence
  "choices": [           // exactly 4 options, exactly one has "correct": true
    { "text": string, "correct": boolean, "consequence": string, "explanation": string }
  ],
  "socratic": string     // one short follow-up question asking the learner to explain their reasoning
}`;

/** The template as the generator and critic see it: text and the answer key, nothing else. */
const templateJson = (t: Scene, withKey: boolean) => JSON.stringify({
  narration: t.narration,
  prompt: t.prompt,
  choices: t.choices.map((c) => (withKey ? { text: c.text, correct: c.correct } : { id: c.id, text: c.text })),
});

export const buildScenePrompt = (
  req: SceneRequest,
  template?: Scene,
  feedback: string[] = [],
): { system: string; user: string } => {
  const supporting = req.supporting.map((t) => `- ${t.term} (Ch. ${t.chapter}): ${t.definition}`).join('\n');
  const story = req.storySoFar.length ? req.storySoFar.map((s) => `- ${s}`).join('\n') : '- (this is the opening scene)';
  const naturalUse = req.stage >= 3 && req.stage !== 5;
  const system = `You write scenes for an educational adventure game that teaches the ISACA AI Fundamentals exam (Chapters 1-5).
The learner plays an AI advisor. Each scene is one decision point in an ongoing story. It is not a quiz: the question must arise from the situation, and each choice must lead to a believable consequence for the team.

Hard rules:
- Score exactly one anchor concept. Other concepts may appear only to explain it.
- Stay faithful to the exam definitions given. Never contradict them or invent facts about real organizations or laws.
- Exactly one choice is correct. Wrong choices must be plausible near-misses that a learner might confuse with the anchor, never jokes.
- "explanation" says why that choice is right or wrong using the exam wording; for wrong choices include the deciding clue.
- "consequence" is what happens in the story if the learner picks it.
- ${naturalUse ? 'Use the anchor term naturally; do not define it.' : 'Do not name the anchor term in the narration; describe the situation so the learner must recognize it.'}
- The setting is ${req.setting.kind === 'familiar' ? "an analogy based on the learner's own project: describe hypothetical behavior, never claim the real project implements it" : 'a fictional organization'}.
- Output JSON only, matching this shape:
${SCENE_SCHEMA}`;

  const user = `Expedition: ${req.chain.title} (${req.chain.path})
Exam cue for this expedition: ${req.chain.cue}
Current link ${req.stepIndex + 1} of ${req.chain.steps.length}, Chapter ${req.step.chapter} — ${CHAPTERS[req.step.chapter].title}: ${req.step.beat}

Anchor concept (the only thing scored): ${req.anchor.term}
Exam definition: ${req.anchor.definition}
${req.contrast ? `Closest confusion: ${req.contrast.partner.term} — ${req.contrast.partner.definition}\nDeciding clue: ${req.contrast.clue}\n` : ''}Supporting concepts (context only):
${supporting || '- none'}

Teaching mode: ${MODE_LABELS[req.mode]}. ${MODE_GUIDANCE[req.mode]}
Learner's terminology stage for the anchor: ${STAGE_NAMES[req.stage]}${req.missesOnStep > 0 ? `\nThe learner has missed this link ${req.missesOnStep} time(s) in this expedition: use new wording and a different angle.` : ''}

Setting: ${req.setting.name}. ${req.setting.premise}
Cast: ${req.setting.cast.join('; ')}
Team meters (0-100): trust ${req.meters.trust}, budget ${req.meters.budget}, risk ${req.meters.risk}
Story so far:
${story}

${req.confirming ? 'The learner just got this link right; this scene confirms it from a different angle before the story moves on.\n' : ''}${template ? `
Reference template (a real scene built from the exam definitions). Keep its correct concept and the kind of near-miss distractors it uses, but write a richer, more realistic story in the setting:
${templateJson(template, true)}
` : ''}${feedback.length ? `
A reviewer rejected your previous draft. Fix every point:
${feedback.map((f) => `- ${f}`).join('\n')}
` : ''}
Write the next scene as JSON.`;
  return { system, user };
};

export const buildNotePrompt = (req: SceneRequest, choiceText: string, note: string): { system: string; user: string } => ({
  system: `You are a friendly, precise tutor for the ISACA AI Fundamentals exam. Judge a learner's explanation against the exam definition. Respond to their reasoning first: say what is right, then repair any gap in one or two sentences. Be casual and kind, never vague. Output JSON only: {"verdict": "solid" | "partial" | "off", "feedback": string}`,
  user: `Concept: ${req.anchor.term}
Exam definition: ${req.anchor.definition}
${req.contrast ? `Closest confusion: ${req.contrast.partner.term}. Deciding clue: ${req.contrast.clue}\n` : ''}The learner chose: ${choiceText}
Their explanation: ${note}`,
});

/**
 * The critic answers the candidate's question blind, as a learner would. If it
 * picks a different choice from the one keyed correct, the scene is ambiguous
 * or mis-keyed and goes back to the generator.
 */
export const buildCriticPrompt = (req: SceneRequest, candidate: Scene): { system: string; user: string } => ({
  system: `You review scenes for an ISACA AI Fundamentals study game. Answer the scene's question yourself using only the exam definition given, then check the scene for anything that contradicts that definition. Output JSON only: {"answer": "<choice id>", "contradicts_definition": boolean, "issues": [string]}`,
  user: `Concept being tested: ${req.anchor.term}
Exam definition: ${req.anchor.definition}
${req.contrast ? `Closest confusion: ${req.contrast.partner.term} — ${req.contrast.partner.definition}\n` : ''}
Scene:
${templateJson(candidate, false)}

Which choice id is correct, and does any part of the scene contradict the exam definition?`,
});
