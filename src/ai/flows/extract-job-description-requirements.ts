'use server';
/**
 * @fileOverview This file implements a Genkit flow for extracting key requirements from a job description.
 *
 * - extractJobDescriptionRequirements - A function that analyzes a job description to identify key skills, required experience, and essential qualifications.
 * - ExtractJobDescriptionRequirementsInput - The input type for the extractJobDescriptionRequirements function.
 * - ExtractJobDescriptionRequirementsOutput - The return type for the extractJobDescriptionRequirements function.
 */

import { ai, executeWithRetryAndFallback } from '@/ai/genkit';
import { z } from 'genkit';

const ExtractJobDescriptionRequirementsInputSchema = z.object({
  jobDescription: z.string().describe('The full text of the job description.'),
});
export type ExtractJobDescriptionRequirementsInput = z.infer<typeof ExtractJobDescriptionRequirementsInputSchema>;

const ExtractJobDescriptionRequirementsOutputSchema = z.object({
  keySkills: z.array(z.string()).describe('A list of key skills required for the job.'),
  requiredExperience: z
    .array(z.string())
    .describe('A list of required experience qualifications for the job.'),
  essentialQualifications: z
    .array(z.string())
    .describe('A list of essential educational or professional qualifications for the job.'),
});
export type ExtractJobDescriptionRequirementsOutput = z.infer<typeof ExtractJobDescriptionRequirementsOutputSchema>;

export async function extractJobDescriptionRequirements(
  input: ExtractJobDescriptionRequirementsInput
): Promise<ExtractJobDescriptionRequirementsOutput> {
  return extractJobDescriptionRequirementsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'extractJobDescriptionRequirementsPrompt',
  input: { schema: ExtractJobDescriptionRequirementsInputSchema },
  output: { schema: ExtractJobDescriptionRequirementsOutputSchema },
  prompt: `You are an expert job analyst. Your task is to carefully read the provided job description and extract specific key information.

Identify and list the following:
1.  **Key Skills**: List all technical, soft, and specialized skills mentioned as required or highly desired.
2.  **Required Experience**: List specific experience requirements, such as years of experience in a particular role or domain, specific project experience, or experience with certain methodologies.
3.  **Essential Qualifications**: List any mandatory educational degrees, certifications, or licenses.

Present the extracted information in a structured JSON format as described by the output schema.

Job Description:
{{{jobDescription}}}`,
});

const extractJobDescriptionRequirementsFlow = ai.defineFlow(
  {
    name: 'extractJobDescriptionRequirementsFlow',
    inputSchema: ExtractJobDescriptionRequirementsInputSchema,
    outputSchema: ExtractJobDescriptionRequirementsOutputSchema,
  },
  async (input) => {
    return executeWithRetryAndFallback(async (modelName) => {
      const { output } = await prompt(input, { model: modelName } as any);
      return output!;
    });
  }
);
