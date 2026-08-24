/**
 * @fileOverview Source vocabulary for the synthetic corpus.
 *
 * Every name, company and institution below is invented. None of them is drawn
 * from a real person's resume, which is the reason this corpus can be checked into
 * a public repository at all — a resume dataset is a pile of personal data, and
 * "I anonymised it" is not a defence when the employment history is intact.
 *
 * Two properties of these pools are deliberate and are asserted by
 * `eval/tests/contamination.test.ts`:
 *
 *  1. **Nothing here appears in the few-shot exemplars.** If the prompt's worked
 *     examples used names from this file, the few-shot arm would score higher for
 *     reasons that have nothing to do with few-shot prompting.
 *  2. **Names are not Anglocentric and not uniformly formatted.** Hyphenation,
 *     diacritics, particles ("van der"), mononym-adjacent short names and ALL-CAPS
 *     conventions are all represented, because a parser that only handles
 *     `Firstname Lastname` looks excellent on a homogeneous corpus and falls over
 *     on a real applicant pool. Making the corpus easy is the most common way to
 *     manufacture a high accuracy number.
 */

export const GIVEN_NAMES = [
  'Aarav', 'Ifeoma', 'Bjørn', 'Priyanka', 'Tomasz', 'Nour', 'Kwame', 'Élodie',
  'Rin', 'Mateus', 'Saoirse', 'Dmitri', 'Anaya', 'Hyun-woo', 'Zeynep', 'Oluwaseun',
  'Lars', 'Meera', 'Xiulan', 'Rafael', 'Ingrid', 'Tariq', 'Nadia', 'Csaba',
  'Amara', 'Joon', 'Ravindra', 'Beatriz', 'Ola', 'Yusuf', 'Linnea', 'Chidi',
] as const;

export const FAMILY_NAMES = [
  'Venkataraman', 'Okoro-Fitzgerald', 'Nakamura', 'da Silva Pereira', 'Kowalczyk',
  'Al-Rashid', 'Mensah', 'Lindqvist', 'Bhattacharya', 'van der Meulen', 'Ó Súilleabháin',
  'Petrov', 'Raghunathan', 'Kim', 'Yıldırım', 'Adeyemi', 'Haugen', 'Krishnamurthy',
  'Zhao', 'Moreira', 'Bergström', 'Haddad', 'Novak', 'Szabó', 'Nwachukwu',
  'Park', 'Deshpande', 'Carvalho', 'Nowak', 'Demirel',
] as const;

export const CITIES = [
  'Bengaluru, India', 'Kraków, Poland', 'Lagos, Nigeria', 'Trondheim, Norway',
  'Porto, Portugal', 'Hyderabad, India', 'Seoul, South Korea', 'Amman, Jordan',
  'Rotterdam, Netherlands', 'Galway, Ireland', 'Pune, India', 'İzmir, Türkiye',
  'Gothenburg, Sweden', 'Accra, Ghana', 'Belo Horizonte, Brazil', 'Brno, Czechia',
  'Chennai, India', 'Fukuoka, Japan', 'Wrocław, Poland', 'Nairobi, Kenya',
] as const;

export const EMAIL_DOMAINS = [
  'mailbox.dev', 'northwind-mail.net', 'inbox.example', 'protonpost.io',
  'lumenmail.co', 'fastpost.email', 'quietbox.org',
] as const;

/** Invented employers. Deliberately varied in shape: suffixes, ampersands, acronyms. */
export const COMPANIES = [
  'Halcyon Grid Systems', 'Meridian Freight Labs', 'Ptarmigan Analytics',
  'Kestrel & Vale', 'Boreal Instrument Co.', 'Umbra Robotics', 'Saltmarsh Health',
  'Cindershift Technologies', 'NorthPeak Logistics GmbH', 'Verdigris Payments',
  'Tessellate AI', 'Orpiment Media', 'Quillon Semiconductor', 'Driftwood Retail Group',
  'Alder & Finch Advisory', 'Ravelin Mobility', 'Sunstone Bioinformatics',
  'Thicket Games Studio', 'Palisade Energy Networks', 'Coriolis Weather Systems',
  'Bramblewood Insurance', 'Ferrite Cloud', 'Wayfinder Maritime', 'Copperline Foods',
  'Ashgrove Telecom', 'Nimbus Freight Exchange', 'Vantablack Security',
] as const;

export const INSTITUTIONS = [
  'Fenwold University', 'Indian Institute of Applied Sciences, Pilani',
  'Nordvik Technical University', 'University of Rothbury',
  'Kalinga Institute of Engineering', 'Universidade de Braganca',
  'Halgren College of Technology', 'National Institute of Computing, Surat',
  'Ardennes Polytechnic', 'University of West Marches',
  'Chandrapur Institute of Technology', 'Aurelian University',
  'Blackwater State University', 'Institute of Data Sciences, Bhopal',
] as const;

export const DEGREES = [
  'B.Tech in Computer Science and Engineering',
  'B.E. in Information Technology',
  'BSc Computer Science',
  'BSc (Hons) Data Science',
  'M.Tech in Artificial Intelligence',
  'MSc Machine Learning',
  'MS in Computer Science',
  'MBA, Operations',
  'B.Tech in Electronics and Communication',
  'PhD in Statistical Signal Processing',
  'BSc Computational Biology',
  'Diploma in Software Engineering',
] as const;

export interface Discipline {
  name: string;
  titles: readonly string[];
  skills: readonly string[];
  achievements: readonly string[];
  certifications: readonly string[];
}

export const DISCIPLINES: readonly Discipline[] = [
  {
    name: 'backend',
    titles: ['Backend Engineer', 'Senior Backend Engineer', 'Staff Software Engineer', 'Platform Engineer', 'Software Development Engineer II'],
    skills: ['Go', 'PostgreSQL', 'gRPC', 'Kafka', 'Redis', 'Kubernetes', 'Terraform', 'Java', 'Spring Boot', 'Distributed systems', 'Event sourcing', 'OpenTelemetry'],
    achievements: [
      'Cut p99 checkout latency from 840ms to 210ms by replacing a synchronous fan-out with a materialised read model.',
      'Migrated 43 services off a shared Postgres instance onto per-service databases with zero downtime.',
      'Designed the idempotency layer for the payments API, eliminating duplicate charges during retry storms.',
      'Introduced backpressure to the ingest pipeline, holding throughput at 40k events/second under a 6x traffic spike.',
      'Reduced cloud spend 31% by rightsizing node pools and moving batch work to spot capacity.',
    ],
    certifications: ['AWS Certified Solutions Architect – Associate', 'Certified Kubernetes Administrator (CKA)'],
  },
  {
    name: 'ml',
    titles: ['Machine Learning Engineer', 'Applied Scientist', 'Research Engineer', 'Senior ML Engineer', 'Data Scientist'],
    skills: ['PyTorch', 'Python', 'Transformers', 'ONNX Runtime', 'Ray', 'MLflow', 'Feature engineering', 'A/B testing', 'Causal inference', 'CUDA', 'scikit-learn', 'Vector databases'],
    achievements: [
      'Trained a 340M-parameter ranking model that lifted click-through rate 4.2% in a two-week online test.',
      'Built the offline evaluation harness the team now gates every model launch on; cut regression escapes to zero over four quarters.',
      'Distilled a 7B document classifier into a 400M student, holding 98.1% of macro-F1 at a fifth of the serving cost.',
      'Diagnosed a training/serving skew that had been suppressing recall 9 points for eight months.',
      'Replaced hand-tuned heuristics with a calibrated gradient-boosted model, reducing manual review volume 38%.',
    ],
    certifications: ['TensorFlow Developer Certificate', 'Google Cloud Professional Machine Learning Engineer'],
  },
  {
    name: 'frontend',
    titles: ['Frontend Engineer', 'Senior Frontend Engineer', 'UI Engineer', 'Web Platform Engineer'],
    skills: ['TypeScript', 'React', 'Next.js', 'WebAssembly', 'CSS architecture', 'Accessibility (WCAG 2.2)', 'Playwright', 'Vite', 'GraphQL', 'Design systems'],
    achievements: [
      'Rebuilt the dashboard shell around route-level code splitting, dropping time-to-interactive from 6.1s to 1.8s on mid-tier Android.',
      'Led the accessibility remediation that took the checkout flow from 41 to zero critical axe violations.',
      'Shipped a design-system migration across 210 components without a feature freeze.',
      'Introduced visual regression testing, catching 27 layout defects before release in the first quarter.',
    ],
    certifications: ['IAAP Certified Professional in Accessibility Core Competencies'],
  },
  {
    name: 'data',
    titles: ['Data Engineer', 'Analytics Engineer', 'Senior Data Engineer', 'Data Platform Engineer'],
    skills: ['Spark', 'dbt', 'Airflow', 'Snowflake', 'SQL', 'Delta Lake', 'Data modelling', 'Great Expectations', 'Flink', 'Python'],
    achievements: [
      'Consolidated 14 overlapping reporting pipelines into a single dbt project, cutting nightly runtime from 5h to 47m.',
      'Introduced contract tests at the ingestion boundary, reducing downstream data incidents 62% year over year.',
      'Backfilled six years of clickstream into a partitioned lakehouse without exceeding the existing warehouse budget.',
      'Built the lineage graph that the finance team now uses to sign off on revenue reporting.',
    ],
    certifications: ['Databricks Certified Data Engineer Professional', 'SnowPro Core Certification'],
  },
  {
    name: 'security',
    titles: ['Security Engineer', 'Application Security Engineer', 'Senior Security Engineer', 'Detection Engineer'],
    skills: ['Threat modelling', 'Burp Suite', 'Rust', 'eBPF', 'SIEM tuning', 'OAuth 2.1', 'Cryptographic protocol review', 'Incident response', 'Fuzzing'],
    achievements: [
      'Found and fixed an authorisation bypass in the partner API that had been exploitable for 14 months.',
      'Cut mean time to detect from 41 hours to 90 minutes by rewriting the detection rules around behavioural baselines.',
      'Ran the fuzzing programme that surfaced 19 memory-safety defects in the media decoder before launch.',
      'Drove the migration off long-lived static credentials to workload identity across 300 CI pipelines.',
    ],
    certifications: ['OSCP', 'CISSP', 'GIAC Web Application Penetration Tester (GWAPT)'],
  },
  {
    name: 'product',
    titles: ['Product Manager', 'Senior Product Manager', 'Technical Program Manager', 'Product Analyst'],
    skills: ['Roadmapping', 'SQL', 'Experiment design', 'Stakeholder management', 'Amplitude', 'Discovery interviews', 'Pricing strategy', 'OKR planning'],
    achievements: [
      'Killed three features representing 40% of the roadmap after usage analysis showed under 2% weekly reach.',
      'Ran the pricing experiment that raised ARPU 11% without measurable churn impact.',
      'Shipped the self-serve onboarding flow that removed sales from 60% of new-account activations.',
      'Rebuilt the quarterly planning process around measurable bets; on-time delivery went from 48% to 81%.',
    ],
    certifications: ['Certified Scrum Product Owner (CSPO)', 'Pragmatic Institute PMC-III'],
  },
] as const;

export const SOFT_SKILLS = [
  'Technical writing', 'Mentoring', 'Cross-functional collaboration', 'Incident command',
  'Stakeholder communication', 'Code review', 'Public speaking',
] as const;

/** Section heading variants. A parser keyed to one spelling should not score well. */
export const HEADINGS = {
  experience: ['EXPERIENCE', 'WORK EXPERIENCE', 'PROFESSIONAL EXPERIENCE', 'EMPLOYMENT HISTORY', 'Experience'],
  education: ['EDUCATION', 'Education', 'ACADEMIC BACKGROUND'],
  skills: ['SKILLS', 'TECHNICAL SKILLS', 'CORE COMPETENCIES', 'Skills', 'TECHNOLOGIES'],
  certifications: ['CERTIFICATIONS', 'Certifications', 'LICENSES & CERTIFICATIONS', 'CREDENTIALS'],
  summary: ['SUMMARY', 'PROFESSIONAL SUMMARY', 'PROFILE', 'OBJECTIVE'],
} as const;

/**
 * Unconventional section headings, used by roughly a third of the corpus.
 *
 * This is the single most discriminative axis in the whole generator, and it is in
 * here because it is what real resumes actually do — people write "Where I've
 * Worked" and "Toolbox" all the time. A rule-based parser segments on a fixed
 * vocabulary and simply cannot find these sections; a language model reads the
 * heading and understands it. Without this axis the corpus is uniform enough that
 * regex saturates near the ceiling, the LLM arms have no headroom, and the whole
 * comparison stops being able to distinguish anything.
 */
export const CREATIVE_HEADINGS = {
  experience: ["WHERE I'VE WORKED", 'CAREER SO FAR', 'WHAT I HAVE BUILT', 'Selected Roles', 'PROFESSIONAL JOURNEY'],
  education: ['SCHOOLING', 'ACADEMICS', 'Where I Studied', 'STUDIES'],
  skills: ['TOOLBOX', 'WHAT I WORK WITH', 'Things I Know', 'STACK', 'CAPABILITIES'],
  certifications: ['BADGES', 'TRAINING', 'Extra Qualifications', 'ACCREDITATIONS'],
  summary: ['IN SHORT', 'ABOUT ME', 'The Short Version', 'HELLO'],
} as const;

/**
 * Lines that look like contact details but are not the labelled fields. Present so
 * that a parser which grabs the first URL-ish or email-ish thing it sees is caught
 * doing it, and scored as a hallucination rather than quietly rewarded.
 */
export const HEADER_DISTRACTORS = [
  'Portfolio: {slug}.dev',
  'github.com/{slug}',
  'linkedin.com/in/{slug}',
  'References available on request',
  'Open to relocation',
] as const;

export const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

export const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;
