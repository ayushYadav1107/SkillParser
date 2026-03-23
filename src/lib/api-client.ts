// API client functions for resume screening

interface AnalyzeJobResponse {
    success: boolean;
    data: {
        keySkills: string[];
        requiredExperience: string[];
        essentialQualifications: string[];
    };
}

interface ExtractResumeResponse {
    success: boolean;
    data: Record<string, any>;
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

export async function extractResume(resumeDataUri: string): Promise<ExtractResumeResponse> {
    const response = await fetch('/api/extract-resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeDataUri }),
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
