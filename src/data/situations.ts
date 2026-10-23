// Situations a scene can happen in, layered on top of the expedition's setting so
// that consecutive scenes, and a re-asked link after a miss, put the concept in a
// different moment instead of restating its definition. They describe what is
// happening, never facts about a real organization or about the learner's projects.

export type Situation = { id: string; moment: string };

export const SITUATIONS: Situation[] = [
  { id: 'incident-review', moment: 'A post-incident review: something went wrong last week and the team is tracing why.' },
  { id: 'vendor-pitch', moment: 'A vendor is demoing a product and making claims the team has to check.' },
  { id: 'budget-meeting', moment: 'A budget meeting where finance wants a clear yes or no.' },
  { id: 'customer-complaint', moment: 'A customer complaint has escalated and needs an answer today.' },
  { id: 'audit-finding', moment: 'An internal auditor has raised a finding the team must respond to.' },
  { id: 'pilot-results', moment: 'The first pilot results have just come in.' },
  { id: 'design-review', moment: 'A design review, before anything is built.' },
  { id: 'new-hire', moment: 'A new team member asks why things are done this way.' },
  { id: 'regulator-questions', moment: 'A regulator has sent written questions about the system.' },
  { id: 'night-alert', moment: 'A monitoring alert fires late at night and someone has to decide what to do.' },
  { id: 'board-briefing', moment: 'You have five minutes to brief the board.' },
  { id: 'data-handoff', moment: 'Another team hands over a dataset and wants to start using it immediately.' },
  { id: 'scope-change', moment: 'A stakeholder wants to extend the system to a new use it was not built for.' },
  { id: 'competitor-news', moment: 'A competitor has announced something similar, and leadership is nervous.' },
];

export const SITUATION_BY_ID: ReadonlyMap<string, Situation> = new Map(SITUATIONS.map((s) => [s.id, s]));
