'use server';
/**
 * @fileOverview This file implements a Genkit flow for calculating a matching score
 * between a candidate's resume and a job description. It leverages AI to analyze
 * text similarity and incorporate specific hiring criteria.
 *
 * - calculateResumeMatchScore - The main function to call for resume-job description matching.
 * - CalculateResumeMatchScoreInput - The input type for the matching process.
 * - CalculateResumeMatchScoreOutput - The output type containing the match score and details.
 */

import { ai, executeWithRetryAndFallback } from '@/ai/genkit';
import { z } from 'genkit';

const CalculateResumeMatchScoreInputSchema = z.object({
  resumeText: z
    .string()
    .describe("The extracted text content from the candidate's resume."),
  jobDescriptionText: z
    .string()
    .describe('The text content of the job description.'),
  hiringCriteria: z
    .array(z.string())
    .optional()
    .describe(
      'An optional list of specific hiring criteria or keywords to prioritize in matching.'
    ),
});
export type CalculateResumeMatchScoreInput = z.infer<
  typeof CalculateResumeMatchScoreInputSchema
>;

const CalculateResumeMatchScoreOutputSchema = z.object({
  matchScore: z
    .number()
    .min(0)
    .max(100)
    .describe('A numerical matching score between 0 and 100, where 100 is a perfect match.'),
  reasons: z
    .string()
    .describe(
      'A detailed explanation of the matching score, highlighting strengths and weaknesses of the resume against the job description.'
    ),
  matchedSkills: z
    .array(z.string())
    .describe(
      'A list of key skills or requirements from the job description that were found in the resume.'
    ),
  missingSkills: z
    .array(z.string())
    .describe(
      'A list of key skills or requirements from the job description that were NOT found or were weakly present in the resume.'
    ),
});
export type CalculateResumeMatchScoreOutput = z.infer<
  typeof CalculateResumeMatchScoreOutputSchema
>;

export async function calculateResumeMatchScore(
  input: CalculateResumeMatchScoreInput
): Promise<CalculateResumeMatchScoreOutput> {
  return calculateResumeMatchScoreFlow(input);
}

const resumeMatchPrompt = ai.definePrompt({
  name: 'resumeMatchPrompt',
  input: { schema: CalculateResumeMatchScoreInputSchema },
  output: { schema: CalculateResumeMatchScoreOutputSchema },
  prompt: `You are an expert HR recruiter and AI-powered resume analyzer. Your task is to analyze a candidate's resume against a job description and calculate a comprehensive matching score.

Resume:
{{{resumeText}}}

Job Description:
{{{jobDescriptionText}}}

{{#if hiringCriteria}}
Additional Specific Hiring Criteria to prioritize (if applicable):
{{#each hiringCriteria}}
- {{{this}}}
{{/each}}
{{/if}}

Please perform the following steps:
1.  Thoroughly compare the resume content with the job description requirements.
2.  Consider all aspects including skills, experience, education, and keywords.
3.  Pay close attention to any "Additional Specific Hiring Criteria" provided.
4.  Calculate a matching score out of 100. A score of 100 means a perfect fit.
5.  Provide detailed reasons for the score, explaining why certain aspects matched well or were lacking.
6.  Identify and list key skills or requirements from the job description that are clearly present in the resume.
7.  Identify and list key skills or requirements from the job description that are either missing or weakly represented in the resume.

Your output must strictly adhere to the following JSON schema. Do not include any other text outside the JSON.`,
});

const calculateResumeMatchScoreFlow = ai.defineFlow(
  {
    name: 'calculateResumeMatchScoreFlow',
    inputSchema: CalculateResumeMatchScoreInputSchema,
    outputSchema: CalculateResumeMatchScoreOutputSchema,
  },
  async (input) => {
    return executeWithRetryAndFallback(async (modelName) => {
      const { output } = await resumeMatchPrompt(input, { model: modelName } as any);
      return output!;
    });
  }
);
