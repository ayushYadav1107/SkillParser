'use server';
/**
 * @fileOverview A Genkit flow for extracting key information from a candidate's resume using AI.
 *
 * - extractResumeInformation - A function that extracts key information from a resume.
 * - ExtractResumeInformationInput - The input type for the extractResumeInformation function.
 * - ExtractResumeInformationOutput - The return type for the extractResumeInformation function.
 */

import { ai, executeWithRetryAndFallback } from '@/ai/genkit';
import { z } from 'genkit';

const ExtractResumeInformationInputSchema = z.object({
  resumeDataUri: z
    .string()
    .describe(
      "The resume document as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'. Supported MIME types are application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document, and image/jpeg, image/png."
    ),
});
export type ExtractResumeInformationInput = z.infer<typeof ExtractResumeInformationInputSchema>;

const ExperienceEntrySchema = z.object({
  title: z.string().describe("Job title or role."),
  company: z.string().describe("Name of the company or organization."),
  duration: z.string().describe("Duration of employment (e.g., 'Jan 2020 - Dec 2022')."),
  description: z.string().describe("Key responsibilities and achievements in bullet points or a short paragraph."),
});

const EducationEntrySchema = z.object({
  degree: z.string().describe("Degree or qualification obtained."),
  institution: z.string().describe("Name of the educational institution."),
  graduationDate: z.string().describe("Date of graduation or completion (e.g., 'May 2022')."),
});

const ExtractResumeInformationOutputSchema = z.object({
  skills: z.array(z.string()).describe("A list of technical and soft skills."),
  experience: z.array(ExperienceEntrySchema).describe("A list of work experiences."),
  education: z.array(EducationEntrySchema).describe("A list of educational background entries."),
  certifications: z.array(z.string()).describe("A list of professional certifications."),
});
export type ExtractResumeInformationOutput = z.infer<typeof ExtractResumeInformationOutputSchema>;

export async function extractResumeInformation(input: ExtractResumeInformationInput): Promise<ExtractResumeInformationOutput> {
  return extractResumeInformationFlow(input);
}

const prompt = ai.definePrompt({
  name: 'extractResumeInformationPrompt',
  input: { schema: ExtractResumeInformationInputSchema },
  output: { schema: ExtractResumeInformationOutputSchema },
  prompt: `You are an expert resume parser. Your task is to extract key information from the provided resume.\nAnalyze the resume and identify the following details:\n- Skills: List all technical and soft skills.\n- Experience: For each work experience, extract the job title, company name, employment duration, and a concise description of responsibilities and achievements.\n- Education: For each educational entry, extract the degree obtained, the institution name, and the graduation date.\n- Certifications: List any professional certifications mentioned.\n\nPresent the extracted information in a structured JSON format according to the output schema provided.\nDo not include any conversational text, only the JSON output.\n\nResume: {{media url=resumeDataUri}}`,
});

const extractResumeInformationFlow = ai.defineFlow(
  {
    name: 'extractResumeInformationFlow',
    inputSchema: ExtractResumeInformationInputSchema,
    outputSchema: ExtractResumeInformationOutputSchema,
  },
  async (input) => {
    return executeWithRetryAndFallback(async (modelName) => {
      const { output } = await prompt(input, { model: modelName } as any);
      return output!;
    });
  }
);
