// The ten high-value integration chains from the Chapters 1–5 integration guide.
// Each chain is one "expedition": its steps are scenes, and every scene has a
// single anchor term (the only thing it scores) plus supporting terms from the
// chapters needed to explain it. This is the guide's Integration Rule: crossing
// chapters is allowed only to explain the anchor, never for variety.

import type { ChapterId } from './terms';

export type ChainStep = {
  chapter: ChapterId;
  anchor: string;
  supporting: string[];
  beat: string;
};

export type Chain = {
  id: string;
  title: string;
  path: string;
  cue: string;
  steps: ChainStep[];
};

export const CHAINS: Chain[] = [
  {
    id: 'enterprise-decision',
    title: 'The Enterprise AI Decision',
    path: 'Capability → approach → development → architecture → governance',
    cue: 'A technically possible model is not automatically a suitable enterprise investment.',
    steps: [
      { chapter: 1, anchor: 'ani', supporting: ['agi', 'ai'], beat: 'Define the capability the business actually needs and whether it is current ANI.' },
      { chapter: 2, anchor: 'hybrid-ai', supporting: ['rule-based', 'ml-approach', 'symbiotic'], beat: 'Select the operating approach.' },
      { chapter: 3, anchor: 'problem-definition', supporting: ['data-collection', 'supervised', 'model-assessment'], beat: 'Define the task, data, paradigm and assessment.' },
      { chapter: 4, anchor: 'technical-feasibility', supporting: ['cnn', 'transformer', 'model-compression'], beat: 'Pick an architecture the team can actually run.' },
      { chapter: 5, anchor: 'strategic-alignment', supporting: ['roi', 'tco', 'risk-appetite', 'kpi'], beat: 'Decide whether the initiative is worth it and how it is controlled.' },
    ],
  },
  {
    id: 'data-bias-trust',
    title: 'Data Quality, Bias, and Trust',
    path: 'Sampling → preparation → training → model behavior → governance',
    cue: 'Data selection shapes training; training shapes parameters; parameters shape outputs; governance controls the full chain.',
    steps: [
      { chapter: 3, anchor: 'convenience-sampling', supporting: ['nonprobability-sampling', 'representativeness', 'stratified-sampling'], beat: 'How did the observations enter the dataset?' },
      { chapter: 3, anchor: 'data-cleansing', supporting: ['feature-engineering', 'data-augmentation', 'outlier'], beat: 'Preparation shapes model inputs.' },
      { chapter: 4, anchor: 'parameter-update', supporting: ['training', 'weight', 'loss'], beat: 'Training changes parameters according to patterns in the data.' },
      { chapter: 1, anchor: 'statistical-ai', supporting: ['generative-ai', 'historical-bias'], beat: 'Learned systems inherit patterns from their data.' },
      { chapter: 5, anchor: 'fairness-testing', supporting: ['sampling-bias', 'compliance-risk', 'reputational-risk'], beat: 'Governance must catch and control the consequences.' },
    ],
  },
  {
    id: 'metrics-to-business',
    title: 'Model Performance to Business Success',
    path: 'Confusion matrix → model metric → KPI → KGI → scorecard outcome',
    cue: 'High model accuracy does not by itself prove ROI, customer benefit, fairness, or strategic success.',
    steps: [
      { chapter: 3, anchor: 'confusion-matrix', supporting: ['tp', 'fn', 'fp', 'tn'], beat: 'Extract TP, FN, FP and TN before any metric.' },
      { chapter: 3, anchor: 'recall', supporting: ['precision', 'specificity', 'accuracy'], beat: 'Pick the metric whose denominator the situation names.' },
      { chapter: 5, anchor: 'kpi', supporting: ['recall', 'model-accuracy-indicator'], beat: 'A model metric becomes a KPI only when tied to a worthwhile objective.' },
      { chapter: 5, anchor: 'kgi', supporting: ['kpi', 'decision-efficacy'], beat: 'Did the business actually reach its goal?' },
      { chapter: 5, anchor: 'bsc', supporting: ['bsc-customer', 'bsc-financial', 'bsc-internal', 'bsc-learning'], beat: 'Place the effect in a scorecard perspective.' },
    ],
  },
  {
    id: 'explainability-oversight',
    title: 'Explainability and Human Oversight',
    path: 'Model design → reasoning approach → decision use → accountability',
    cue: 'Explainability is both a technical property and a governance requirement.',
    steps: [
      { chapter: 1, anchor: 'symbolic-ai', supporting: ['statistical-ai'], beat: 'Explicit representations versus learned patterns.' },
      { chapter: 2, anchor: 'expert-system', supporting: ['knowledge-base', 'inference-engine', 'explainability'], beat: 'Rule and expert systems are easier to inspect.' },
      { chapter: 2, anchor: 'symbiotic', supporting: ['hitl', 'automation-bias', 'decision-support'], beat: 'The human keeps context, judgment and accountability.' },
      { chapter: 4, anchor: 'interpretability', supporting: ['latent-space', 'attention', 'depth'], beat: 'Depth, latent representations and attention complicate explanation.' },
      { chapter: 5, anchor: 'human-oversight', supporting: ['accountability', 'eu-ai-act', 'explainability'], beat: 'Risk and regulation set the oversight required.' },
    ],
  },
  {
    id: 'deepfakes',
    title: 'Deepfakes and Generative-AI Risk',
    path: 'Generative capability → architecture → content → misuse → detection and control',
    cue: 'Generator vs discriminator = GAN; encoder–latent–decoder = VAE; iterative denoising = diffusion; self-attention = Transformer; spatial filters = CNN.',
    steps: [
      { chapter: 1, anchor: 'generative-ai', supporting: ['discriminative-ai', 'transformer'], beat: 'Generative AI is a capability, not one architecture.' },
      { chapter: 4, anchor: 'gan', supporting: ['generator', 'discriminator', 'vae', 'diffusion'], beat: 'Which architecture produced the fake?' },
      { chapter: 4, anchor: 'cnn', supporting: ['kernel', 'feature-map', 'image-forensics'], beat: 'CNNs can classify manipulated images.' },
      { chapter: 5, anchor: 'impersonation', supporting: ['deepfake', 'disinformation', 'misinformation'], beat: 'Name the harm.' },
      { chapter: 5, anchor: 'provenance', supporting: ['image-forensics', 'control', 'hitl'], beat: 'Choose the controls.' },
    ],
  },
  {
    id: 'cia-security',
    title: 'Cybersecurity and the CIA Triad',
    path: 'Asset → lifecycle stage → threat → CIA impact → control',
    cue: 'Privacy and confidentiality overlap but are not identical.',
    steps: [
      { chapter: 3, anchor: 'training-data', supporting: ['trained-model', 'model-assessment'], beat: 'Identify the lifecycle asset at stake.' },
      { chapter: 4, anchor: 'parameter', supporting: ['embedding', 'weight'], beat: 'Technical assets live inside the model too.' },
      { chapter: 5, anchor: 'data-poisoning', supporting: ['threat-source', 'cybersecurity'], beat: 'What can an attacker do to those assets?' },
      { chapter: 5, anchor: 'integrity', supporting: ['confidentiality', 'availability', 'cia-triad'], beat: 'Which leg of the CIA triad is hit?' },
      { chapter: 5, anchor: 'cobit', supporting: ['ai-governance', 'management', 'least-privilege', 'audit-trail'], beat: 'Assign ownership, controls and evidence.' },
    ],
  },
  {
    id: 'data-loss-resilience',
    title: 'Data Loss and Resilience',
    path: 'Storage or transfer failure → missing/corrupt data → model impact → enterprise impact → recovery',
    cue: 'Backup preserves a copy; resilience includes redundancy, recovery objectives, tested restoration and response.',
    steps: [
      { chapter: 3, anchor: 'data-quality', supporting: ['data-cleansing', 'model-assessment'], beat: 'Missing or damaged data reduces training and assessment quality.' },
      { chapter: 4, anchor: 'gigo', supporting: ['parameter', 'training'], beat: 'Damaged inputs change learned parameters and outputs.' },
      { chapter: 5, anchor: 'data-loss', supporting: ['availability', 'integrity'], beat: 'Storage, backup and migration failures cause data loss.' },
      { chapter: 5, anchor: 'operational-risk', supporting: ['compliance-risk', 'reputational-risk'], beat: 'Name the enterprise consequences.' },
      { chapter: 5, anchor: 'resilience', supporting: ['backup', 'redundancy', 'recovery-objective', 'restoration-testing'], beat: 'Build recovery that actually works.' },
    ],
  },
  {
    id: 'generalization',
    title: 'Unpredictability and Generalization',
    path: 'Training distribution → unfamiliar condition → unexpected output → oversight and fallback',
    cue: 'Good historical performance does not guarantee safe behavior under unfamiliar conditions.',
    steps: [
      { chapter: 3, anchor: 'generalization', supporting: ['training-data', 'overfitting'], beat: 'Training data exemplifies known conditions.' },
      { chapter: 4, anchor: 'inference', supporting: ['training', 'parameter'], beat: 'Inference applies fixed parameters to new inputs.' },
      { chapter: 5, anchor: 'model-drift', supporting: ['monitoring', 'robustness'], beat: 'Conditions shift outside the training environment.' },
      { chapter: 5, anchor: 'human-oversight', supporting: ['hitl', 'resilience'], beat: 'Higher impact demands validation, monitoring and fallback.' },
    ],
  },
  {
    id: 'indicators',
    title: 'Leading and Lagging Indicators',
    path: 'Readiness driver → deployed result → improvement decision',
    cue: '"Leading" does not mean more important; it means predictive or preparatory. "Lagging" means retrospective.',
    steps: [
      { chapter: 3, anchor: 'model-assessment', supporting: ['data-collection', 'preprocessing'], beat: 'Lifecycle stages produce measurable evidence.' },
      { chapter: 5, anchor: 'leading-indicator', supporting: ['data-quality-score', 'model-update-frequency', 'infrastructure-scalability'], beat: 'What predicts future performance?' },
      { chapter: 5, anchor: 'lagging-indicator', supporting: ['model-accuracy-indicator', 'system-reliability', 'data-throughput', 'decision-efficacy'], beat: 'What reports results already achieved?' },
      { chapter: 5, anchor: 'ai-governance', supporting: ['monitoring', 'kpi'], beat: 'Use both to improve, retrain, restrict or retire.' },
    ],
  },
  {
    id: 'governed-hybrid',
    title: 'Rules, Knowledge, and Governed Hybrid AI',
    path: 'Knowledge source → inference or prediction → policy constraint → accountable decision',
    cue: 'A generative model consulting a policy document uses it as a knowledge source; that does not make it a classic expert system.',
    steps: [
      { chapter: 2, anchor: 'knowledge-base', supporting: ['inference-engine', 'training-data'], beat: 'Facts and rules versus training data.' },
      { chapter: 2, anchor: 'ml-approach', supporting: ['rule-based', 'brittleness'], beat: 'Learned patterns versus explicit instructions.' },
      { chapter: 2, anchor: 'hybrid-ai', supporting: ['rule-based', 'ml-approach'], beat: 'Learned predictions inside explicit policy constraints.' },
      { chapter: 2, anchor: 'symbiotic', supporting: ['hitl', 'hybrid-ai'], beat: 'Add human judgment and oversight.' },
      { chapter: 5, anchor: 'accountability', supporting: ['ai-governance', 'control'], beat: 'Who owns the rules, approves changes and accepts the risk?' },
    ],
  },
];

export const CHAIN_BY_ID: ReadonlyMap<string, Chain> = new Map(CHAINS.map((c) => [c.id, c]));

// "Do not confuse" pairs from the guide. They drive contrast scenes and give the
// offline generator near-miss distractors that teach the deciding clue.
export const DISTINCTIONS: { a: string; b: string; clue: string }[] = [
  { a: 'generative-ai', b: 'transformer', clue: 'Generative AI is a capability; a Transformer is an architecture often used for generative systems.' },
  { a: 'nlp', b: 'transformer', clue: 'NLP is a field of language tasks; Transformers are one architecture used for NLP.' },
  { a: 'training-data', b: 'knowledge-base', clue: 'Training data is used to learn parameters; a knowledge base stores explicit facts or rules for consultation.' },
  { a: 'rule-based', b: 'expert-system', clue: 'Rule-based describes explicit rule operation; an expert system is domain-focused, combining a knowledge base and inference engine.' },
  { a: 'hybrid-ai', b: 'symbiotic', clue: 'Hybrid combines AI approaches; symbiotic combines complementary human and AI roles.' },
  { a: 'parameter', b: 'hyperparameter', clue: 'Parameters are learned during training; hyperparameters guide training or configuration.' },
  { a: 'backpropagation', b: 'optimizer', clue: 'Backpropagation computes gradients; the optimizer uses them to update parameters.' },
  { a: 'training', b: 'inference', clue: 'Training adjusts parameters; inference uses fixed learned parameters to produce outputs.' },
  { a: 'kpi', b: 'kgi', clue: 'A KPI measures progress; a KGI measures whether the outcome was achieved.' },
  { a: 'leading-indicator', b: 'lagging-indicator', clue: 'Leading predicts or prepares; lagging reports past results.' },
  { a: 'ai-governance', b: 'management', clue: 'Governance evaluates, directs and monitors; management plans, builds, runs and monitors execution.' },
  { a: 'data-quality', b: 'integrity', clue: 'Quality asks whether data is fit for purpose; integrity asks whether it is protected from improper alteration.' },
  { a: 'privacy', b: 'confidentiality', clue: 'Privacy governs appropriate personal-data use and rights; confidentiality prevents unauthorized disclosure.' },
  { a: 'gdpr', b: 'eu-ai-act', clue: 'GDPR governs personal-data processing; the EU AI Act imposes risk-based requirements on AI systems. Both may apply.' },
  { a: 'backup', b: 'resilience', clue: 'A backup preserves a copy; resilience adds redundancy, recovery planning, tested restoration and response.' },
  { a: 'precision', b: 'recall', clue: 'Precision starts from predicted positives; recall starts from actual positives.' },
  { a: 'recall', b: 'specificity', clue: 'Recall is about actual positives; specificity is about actual negatives.' },
  { a: 'disinformation', b: 'misinformation', clue: 'Disinformation is deliberate; misinformation spreads regardless of intent.' },
  { a: 'overfitting', b: 'underfitting', clue: 'Overfitting memorises training data and generalises poorly; underfitting fails even on training data.' },
  { a: 'cnn', b: 'rnn', clue: 'CNN = local/spatial patterns; RNN = ordered sequence with recurrent state.' },
  { a: 'vae', b: 'gan', clue: 'VAE = encoder → latent → decoder; GAN = generator versus discriminator.' },
  { a: 'gan', b: 'diffusion', clue: 'GAN trains generator against discriminator; diffusion generates through iterative denoising.' },
  { a: 'inductive', b: 'deductive', clue: 'Inductive generalises from examples; deductive derives necessary conclusions from rules.' },
  { a: 'decision-support', b: 'autonomous-decision', clue: 'Decision support leaves the final call with a human; autonomous decision-making does not.' },
];

export const distinctionFor = (a: string, b: string) =>
  DISTINCTIONS.find((d) => (d.a === a && d.b === b) || (d.a === b && d.b === a));

export const contrastPartners = (termId: string): string[] =>
  DISTINCTIONS.flatMap((d) => (d.a === termId ? [d.b] : d.b === termId ? [d.a] : []));
