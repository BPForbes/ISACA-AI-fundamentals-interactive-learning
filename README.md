# ISACA AI Fundamentals — Lifecycle Expedition

An AI-driven study adventure for the ISACA AI Fundamentals exam, Chapters 1–5. It is not a quiz: you play an
advisor to a team, every decision has a consequence in the story, and the story only moves on once the concept at
each link holds up.

## How it plays

- **Five regions, ten expeditions.** Each expedition is one of the ten integration chains from the study guide
  (for example *Confusion matrix → model metric → KPI → KGI → scorecard*). Every scene scores one **anchor**
  concept; other chapters appear only to explain it, so the topic stays locked.
- **Decisions with consequences.** Choices move the team's trust, budget and risk meters, and the consequence of
  each choice is carried into the next scene. A miss keeps the same anchor in play, re-asked from a new angle,
  until it is answered (or parked in the rematch queue after three misses).
- **The tutor picks the teaching mode** from your evidence: Diagnostic for new concepts, Contrast drills for
  near-miss confusions (from the guide's "do not confuse" table), Calculation drills for confusion-matrix metrics,
  Integration drills once a term is in natural use, Remediation after repeated misses, Maintenance when proficient.
- **Points = Base × Risk × Topic bonus × √streak.** Stake 0.25×–4× confidence on each decision. Stakes above 1×
  cost points on a miss; 1× or less is always safe. Points never mark a topic mastered.
- **Two kinds of progress per concept:** mastery level (Unknown → Familiar → Competent → Proficient → Mastered)
  and the terminology ladder (Introduce → Scaffold → Conversational use → Transfer, or Recovery when it slips).
  Familiar settings come from your own projects as analogies; unfamiliar sectors prove transfer.
- **Camp** every six scenes: the guide's queue refresh, and the natural moment to save.
- **Journal**: every term with its level and stage, and the end-of-session study context (YAML) to download.

## AI scenario writing: a GAN-inspired loop

Scenes are made by a generator and checked by a discriminator before you see them:

1. **Template.** The offline engine builds a scene for the link straight from the term bank. It is the "real"
   sample: always faithful to the exam wording, but plain.
2. **Generator.** A language model rewrites the template into a richer story in the expedition's setting, keeping
   its correct concept and kind of near-miss distractors.
3. **Discriminator.** The draft is graded against the template and the exam definition. Rules first: the answer
   key must express the anchor's definition, the story must not give the answer away, exactly one choice may be the
   anchor, and wrong choices should be real course concepts. Optionally an AI critic then answers the question
   blind; if it picks a different choice, or finds a contradiction with the definition, the draft is rejected.
4. **Feedback.** A rejected draft goes back to the generator with the reasons, up to three rounds. If every draft
   fails, the template is used.

Unlike a real GAN, nothing is trained adversarially: the generator is a fixed model and the discriminator is fixed
rules plus a second model call. It borrows the generator-versus-discriminator structure, not the training.
Calculation scenes always use the template so the arithmetic is exact.

## Knowing when to move on: rules + LSTM (hybrid AI)

After each answer the game decides whether the story moves to the next link or confirms this one from a new angle.

- **Rules** (always on): a miss never moves on; after a miss, two correct answers in a row are needed; a link is
  never held for more than two confirmations, and anything still shaky goes to the rematch queue.
- **LSTM progress model**: a small LSTM, trained in a Web Worker on your own answer history, reads each concept's
  sequence of answers and predicts whether your next one will be right, and whether you are improving, steady or
  declining. It only joins the decision once it beats a simple running-accuracy baseline on your newest answers,
  which it was not trained on. Until then the rules decide alone. When it is in use, a correct answer still waits
  for one more confirmation if the model gives the next one less than a 65% chance.

The Journal shows the model's held-out accuracy and log-loss against the baseline, and its forecast per concept.

| Backend | Where it runs | Setup |
| --- | --- | --- |
| In-browser (WebLLM) | Your GPU through WebGPU, like the QPU lab | Settings → Load model (about 2 GB the first time) |
| Cloudflare Workers AI | The `worker/` backend | Deploy the Worker with the `[ai]` binding |
| Ollama | A local Ollama server | `ollama serve`, then pick the model in Settings |
| Offline engine | The browser, no AI | Always available |

## Saving to the cloud

Learning stays in the current session (and a local draft, so a reload loses nothing) until you press **Save**.
A save sends only what changed since the last save — the concepts you touched, the scenes you played, the
rematch queue and a session summary — to a Cloudflare Worker backed by D1. Saves are idempotent, and a newer copy
of a concept is never overwritten by an older one. See [`worker/README.md`](worker/README.md) to deploy it.

## Development

```bash
npm install
npm run dev      # Vite dev server
npm test         # Vitest: engine, session store, AI fallback, Worker API
npm run build    # typecheck and production build
```

| Area | Location |
| --- | --- |
| Term bank, chains, distinctions, settings | `src/data/` |
| Mastery, scoring, teaching-mode director, offline generator | `src/engine/` |
| Model backends and prompts | `src/llm/` |
| Session state, dirty tracking, study-context export | `src/session/` |
| Cloud client | `src/sync/` |
| Cloudflare Worker + D1 migration | `worker/` |

The site deploys to GitHub Pages from `main` through `.github/workflows/deploy-pages.yml`
(Settings → Pages → Source: GitHub Actions).

Study content is drawn from the learner's own ISACA AI Fundamentals notes and terminology bank.
