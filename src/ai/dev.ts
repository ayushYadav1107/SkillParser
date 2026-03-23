import { config } from 'dotenv';
config();

import '@/ai/flows/extract-job-description-requirements.ts';
import '@/ai/flows/calculate-resume-match-score.ts';
import '@/ai/flows/extract-resume-information-flow.ts';