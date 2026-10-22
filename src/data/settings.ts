// Story settings. The guide asks for concept → familiar system → unfamiliar
// scenario: "familiar" settings come from the learner's own projects (and are
// analogies, never claims about what those projects implement), "unfamiliar"
// ones prove transfer to sectors the learner has not built.

export type StorySetting = {
  id: string;
  name: string;
  kind: 'familiar' | 'unfamiliar';
  premise: string;
  cast: string[];
  fits: string[];
};

export const SETTINGS: StorySetting[] = [
  {
    id: 'homework-central',
    name: 'Homework Central',
    kind: 'familiar',
    premise: 'A large student community (React, ASP.NET Core, PostgreSQL, real-time chat) wants AI to route help requests and support moderation.',
    cast: ['Maya, community lead', 'Theo, backend engineer', 'Priya, volunteer moderator'],
    fits: ['adoption-readiness', 'kpi', 'system-reliability', 'human-oversight', 'neural-network', 'backpropagation', 'parameter-update'],
  },
  {
    id: 'keyquorum',
    name: 'KeyQuorum',
    kind: 'familiar',
    premise: 'A hardware-key quorum file-sharing tool (Rust, SQLite) is considering an AI assistant that flags unusual unlock attempts.',
    cast: ['Jordan, security reviewer', 'Sam, operator', 'Alex, auditor'],
    fits: ['cia-triad', 'integrity', 'least-privilege', 'audit-trail', 'ai-governance', 'management', 'anomaly-detection'],
  },
  {
    id: 'emr',
    name: 'The EMR Project',
    kind: 'familiar',
    premise: 'An electronic medical record system (Kotlin/Java, REST APIs, HIPAA scope) is piloting a model that flags patients for follow-up.',
    cast: ['Dr. Okafor, clinical lead', 'Rene, QA engineer', 'Lin, privacy officer'],
    fits: ['hipaa', 'privacy', 'confidentiality', 'recall', 'decision-support', 'human-oversight', 'data-minimization'],
  },
  {
    id: 'qpu-lab',
    name: 'The QPU Portfolio Lab',
    kind: 'familiar',
    premise: 'A browser circuit lab with an in-browser language model that turns plain requests into circuit fixes is being integrated across several repositories.',
    cast: ['Casey, integration lead', 'Morgan, front-end developer'],
    fits: ['technical-feasibility', 'hybrid-ai', 'rule-based', 'inference', 'model-compression', 'leading-indicator'],
  },
  {
    id: 'local-engine',
    name: 'The Laptop AI Engine',
    kind: 'familiar',
    premise: 'A C# AI engine must run on an 8 GB, ninth-generation i5 laptop with no NVIDIA GPU.',
    cast: ['You, the builder', 'Riley, a friend testing it'],
    fits: ['model-selection', 'technical-feasibility', 'roi', 'sustainable-computing', 'pretrained-model', 'fine-tuning'],
  },
  {
    id: 'regional-bank',
    name: 'Harbor Regional Bank',
    kind: 'unfamiliar',
    premise: 'A mid-size bank wants a model to score loan applications and flag fraud.',
    cast: ['Grace, chief risk officer', 'Omar, data scientist', 'Helen, compliance manager'],
    fits: ['historical-bias', 'fairness-testing', 'explainability', 'risk-appetite', 'compliance-risk', 'precision'],
  },
  {
    id: 'hospital',
    name: 'St. Brigid Hospital Network',
    kind: 'unfamiliar',
    premise: 'A hospital network is evaluating an imaging model that flags possible fractures for radiologists.',
    cast: ['Dr. Hale, radiology chief', 'Nadia, CIO', 'Ben, patient-safety lead'],
    fits: ['cnn', 'recall', 'specificity', 'hitl', 'automation-bias', 'eu-ai-act'],
  },
  {
    id: 'logistics',
    name: 'Northwind Freight',
    kind: 'unfamiliar',
    premise: 'A logistics company forecasts delivery delays and routes trucks with ML.',
    cast: ['Ines, operations director', 'Kofi, ML engineer'],
    fits: ['prediction', 'optimization', 'model-drift', 'monitoring', 'data-throughput', 'infrastructure-scalability'],
  },
  {
    id: 'newsroom',
    name: 'The Daily Ledger Newsroom',
    kind: 'unfamiliar',
    premise: 'A newsroom is fighting a wave of synthetic videos of a city official during an election.',
    cast: ['Tess, standards editor', 'Raj, visual forensics analyst'],
    fits: ['deepfake', 'disinformation', 'misinformation', 'impersonation', 'image-forensics', 'provenance', 'gan', 'diffusion'],
  },
  {
    id: 'manufacturer',
    name: 'Copperline Manufacturing',
    kind: 'unfamiliar',
    premise: 'A factory uses sensor data and a vision system to detect defects on the line.',
    cast: ['Viktor, plant manager', 'Ama, quality engineer'],
    fits: ['anomaly-detection', 'perception', 'data-loss', 'resilience', 'operational-risk', 'system-reliability'],
  },
];

export const SETTING_BY_ID: ReadonlyMap<string, StorySetting> = new Map(SETTINGS.map((s) => [s.id, s]));
