import { ExtractResumeInformationOutput } from '@/ai/flows/extract-resume-information-flow';
import { CalculateResumeMatchScoreOutput } from '@/ai/flows/calculate-resume-match-score';

export interface Candidate {
  id: string;
  name: string;
  fileName: string;
  extractedInfo?: ExtractResumeInformationOutput;
  matchResults?: CalculateResumeMatchScoreOutput;
  status: 'idle' | 'processing' | 'completed' | 'error';
  errorMessage?: string;
}

export interface JobAnalysis {
  title?: string;
  description: string;
  keySkills: string[];
  requiredExperience: string[];
  essentialQualifications: string[];
  status: 'idle' | 'analyzing' | 'completed' | 'error';
}