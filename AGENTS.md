# Agent instructions

These rules apply to coding agents and review bots working in this repository.

## What this is

A React + TypeScript + Vite site (GitHub Pages) that teaches ISACA AI Fundamentals Chapters 1–5 as an adventure,
plus a Cloudflare Worker (`worker/`) that stores progress in D1 and can generate scenes with Workers AI.

## Content rules

- `src/data/terms.ts` holds the exam definitions from the learner's own notes. Do not reword a definition unless
  the learner's material changes; scenes may paraphrase, the term bank may not drift.
- Keep the guide's teaching rules: one anchor concept per scene (topic lock), a miss keeps the anchor in play,
  points never override mastery, and familiar (personal-project) settings are analogies, never claims about what
  those projects implement.
- Every scene happens in a situation from `src/data/situations.ts`, a new one for each scene of an expedition
  (a re-asked link included). Scenes test a concept by applying it in that situation; a model draft that recites the
  anchor's definition and asks for its name fails the discriminator's `applied situation` check (explain and
  remediation scenes may teach the definition first). The offline template keeps the exact definition by design.
- Model output is untrusted. Every generated scene must pass `sanitizeScene` and the discriminator
  (`src/engine/discriminator.ts`); never render model text without both. The offline template is the reference
  every draft is graded against, so keep the offline generator faithful to the term bank.
- Call the scene loop GAN-inspired, not a GAN: nothing in it is trained adversarially.
- The LSTM progress model (`src/engine/tracker.ts`) may influence the move-on decision only while its held-out
  assessment beats the baseline. The rules in `decideAdvance` always apply, and the confirmation cap keeps a learner
  from being held on one link indefinitely.
- The attention tracker (`src/engine/attention.ts`) is the attention step of a transformer with fixed biases, not a
  trained transformer; call it that. Its fitted half-life and sharpness apply only while they beat the per-concept
  baseline on held-out answers. Orthogonal concepts (relation 0 in `src/engine/relations.ts`) never inform each other,
  and a concept is mastered or struggling only on its own answers. It may remap (a bridge concept, the recommended
  expedition) but never decides move-on: that stays with `decideAdvance`. The relation table comes from the guide's
  chains, distinctions and sections, never from model output.
- Calculation scenes stay on the offline engine so arithmetic is exact.
- The lab (`src/engine/lab/`) is the game. It is a real, seeded simulation of the lifecycle: define the problem;
  sample, corrupt and clean the data; train a small network by gradient descent; decide cases by rules, the model,
  a hybrid and a capacity-limited reviewer; deploy for six months with drift, controls, incidents, value and cost. It
  decides nothing about mastery. A goal (`src/data/goals.ts`) is a broken setup patched onto the project's lab, a
  target the simulation judges, terms for the debrief (the anchor first) and a solution; `src/data/tests/goals.test.ts`
  must keep proving on five seeds that every setup fails its goal and every solution meets it. Briefs are hypothetical
  ("Suppose…"), fictional, and never hand over a definition; definitions come from `TERM_BY_ID`. A goal that needs a
  capability (`needs`) is posed only once the run owns the upgrade that gives it. A submission goes through
  `submitGoal`, which records it exactly as a scene answer (`mode: 'lab'`), so the teaching rules apply unchanged: a
  miss keeps the goal in play (re-seeded) and the move-on gate decides.
- A project (`src/engine/project.ts`) is one round: goals per stage chosen by the store's priority (rematch queue,
  then level), the lab carried from goal to goal, and the round cleared by the deployed model's business goal. The
  story expeditions are practice outside the run and must not touch it.
- The run (`src/engine/run.ts`, `src/data/upgrades.ts`, `src/data/briefs.ts`) only reads each project's report. An
  upgrade gives the lab a capability (a control unlocked, a cost reduced) and nothing else: never which concept is
  asked, whether a goal counts, mastery, the matrix, the move-on gate or what a goal judges. An upgrade is named after
  a term in the bank and its card quotes that term's definition from `TERM_BY_ID`, never a copy; its "in the lab"
  line is game text, not exam wording. Briefs and their organisations are fictional.
- Third-party assets must be MIT (or more permissive) and listed in `THIRD_PARTY_LICENSES.md` with their notice.
  Icons come from `pixelarticons` through `src/components/PixelIcon.tsx`; add an icon there, not as a loose file.

## Data and security

- Backend order for "auto" is: free hosted model, in-browser model, Cloudflare Workers AI (last resort), offline.
  A hosted-provider API key is the learner's own: it lives only in their browser's localStorage, is sent only to
  that provider, and must never appear in an error message, log, save payload or test literal.
- Uploaded provider keys live only in the Worker vault (`worker/src/vault.ts`): AES-GCM under the
  `KEY_ENCRYPTION_KEY` secret, provider-bound additional data, ciphertext in D1. Never add a route that returns a
  key, never forward a provider's error body (it can quote the key), and never let a caller choose the URL a key is
  sent to. A vaulted key is never written to browser storage.
- No secret in the tree. The sync token is chosen by the learner, stored only in their browser, and the Worker
  holds only its SHA-256 as a `wrangler secret`. Never put a token or its hash in `wrangler.toml` or a test.
- The Worker refuses every authenticated route while `SYNC_TOKEN_SHA256` is unset, and limits CORS to
  `ALLOWED_ORIGINS`. Keep both fail-closed.
- A save is one D1 batch (one transaction) and idempotent by `saveId`; a concept row is only replaced by a newer
  `updatedAt`. Keep both properties, and validate every field before it reaches SQL. The packed mastery matrix
  (`mastery_matrix`, one row) follows the same newer-`updatedAt` rule, and the Worker checks its format byte, list
  version and length before storing it.
- Saves happen on the learner's Save, and automatically (only with the cloud configured) when a concept reaches
  mastery or a struggle is detected; that save is sent when the learner leaves the scene, so the field note goes with
  it. Do not add other automatic saves.

## Workflow

- `npm test` after changes to `src/engine/`, `src/session/`, `src/llm/` or `worker/`; `npm run build` before pushing.
- Tests live in `tests/` folders beside their modules (`src/engine/tests/`, `worker/test/`).
- Make the smallest correct change and match the surrounding style.
- Do not put a model name in commits, pull requests or files.
