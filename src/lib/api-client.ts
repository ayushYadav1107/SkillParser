// API client functions for resume screening

import type { ParsedResume } from '@/lib/resume-schema';

interface AnalyzeJobResponse {
    success: boolean;
    data: {
        keySkills: string[];
        requiredExperience: string[];
        essentialQualifications: string[];
    };
}

/**
 * Telemetry the extraction endpoint returns alongside the data.
 *
 * `degraded` is the field that matters to the UI: it is true when every LLM
 * provider failed and the offline rule-based parser answered instead. That result
 * is still useful, but it is not the same quality as a model extraction, and
 * presenting the two identically would tell the user something untrue.
 */
export interface ExtractResumeMeta {
    provider: string;
    model: string;
    latencyMs: number;
    promptTokens: number;
    completionTokens: number;
    degraded: boolean;
    failoverTrail: string[];
}

interface ExtractResumeResponse {
    success: boolean;
    data: ParsedResume;
    meta: ExtractResumeMeta;
}

import { CalculateResumeMatchScoreOutput } from '@/ai/flows/calculate-resume-match-score';

interface CalculateMatchResponse {
    success: boolean;
    data: CalculateResumeMatchScoreOutput;
}

export async function analyzeJobDescription(jobDescription: string): Promise<AnalyzeJobResponse> {
    const response = await fetch('/api/analyze-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobDescription }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to analyze job description');
    }

    return response.json();
}

export async function extractResume(
    resumeDataUri: string,
    options: { useFewShot?: boolean } = {}
): Promise<ExtractResumeResponse> {
    const response = await fetch('/api/extract-resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeDataUri, useFewShot: options.useFewShot }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to extract resume information');
    }

    return response.json();
}

export async function calculateMatchScore(
    resumeText: string,
    jobDescriptionText: string,
    hiringCriteria: string[]
): Promise<CalculateMatchResponse> {
    const response = await fetch('/api/calculate-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeText, jobDescriptionText, hiringCriteria }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to calculate match score');
    }

    return response.json();
}
