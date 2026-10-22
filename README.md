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

## AI scenario writing

Scenes are written by a language model when one is available, and by the offline story engine otherwise. Every model
answer is validated (3–4 distinct choices, exactly one correct) and falls back to the offline engine if it is not.
Calculation scenes always use the offline engine so the arithmetic is exact.

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
