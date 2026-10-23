// What the model in a run is being trained to do. The job is flavour for the
// roguelike: it names the thing you are building, nothing else depends on it.
// Every organisation here is fictional.

export type Brief = { id: string; title: string; task: string; owner: string };

export const BRIEFS: Brief[] = [
  { id: 'archive', title: 'The survey archive', task: 'sort 40,000 unlabelled survey photographs from the Capability Coast archive', owner: 'the Coastal Survey Office' },
  { id: 'passes', title: 'The frozen passes', task: 'predict which Gradient Gorge passes will ice over before the supply convoys leave', owner: 'the Gorge Convoy Authority' },
  { id: 'radio', title: 'Night watch', task: "triage the base camp's radio traffic so the night watch only hears what matters", owner: 'the Delta Base Camp' },
  { id: 'permits', title: 'The citadel gate', task: "flag forged permits at the Governance Citadel's gate without stalling honest travellers", owner: 'the Citadel Gatehouse' },
  { id: 'shorthand', title: 'Three decades of shorthand', task: 'transcribe the Reasoning Ridge field notes, written in three decades of surveyors’ shorthand', owner: 'the Ridge Cartographic Society' },
  { id: 'pumps', title: 'The failing pumps', task: 'spot failing drainage pumps across the Data Delta from their vibration readings', owner: 'the Delta Water Board' },
];

export const BRIEF_BY_ID: ReadonlyMap<string, Brief> = new Map(BRIEFS.map((b) => [b.id, b]));

const CODENAME_WORDS = ['LANTERN', 'SEXTANT', 'COMPASS', 'BEACON', 'KESTREL', 'TIDEMARK', 'GRANITE', 'EMBER', 'HALYARD', 'MERIDIAN', 'PLOVER', 'QUARRY'];

/** A codename for the model, drawn from the run's own random stream. */
export const codename = (rng: () => number): string =>
  `${CODENAME_WORDS[Math.floor(rng() * CODENAME_WORDS.length)]}-${1 + Math.floor(rng() * 9)}`;
