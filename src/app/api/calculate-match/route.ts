import { NextRequest, NextResponse } from 'next/server';
import { calculateResumeMatchScore } from '@/ai/flows/calculate-resume-match-score';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { resumeText, jobDescriptionText, hiringCriteria } = body;

        // Input validation
        if (!resumeText || typeof resumeText !== 'string') {
            return NextResponse.json(
                { error: 'Resume text is required and must be a string' },
                { status: 400 }
            );
        }

        if (!jobDescriptionText || typeof jobDescriptionText !== 'string') {
            return NextResponse.json(
                { error: 'Job description text is required and must be a string' },
                { status: 400 }
            );
        }

        if (resumeText.trim().length < 10) {
            return NextResponse.json(
                { error: 'Resume content is too short' },
                { status: 400 }
            );
        }

        if (jobDescriptionText.trim().length < 10) {
            return NextResponse.json(
                { error: 'Job description content is too short' },
                { status: 400 }
            );
        }

        // Call Genkit flow
        const result = await calculateResumeMatchScore({
            resumeText: resumeText.trim(),
            jobDescriptionText: jobDescriptionText.trim(),
            hiringCriteria: Array.isArray(hiringCriteria) ? hiringCriteria : [],
        });

        return NextResponse.json({
            success: true,
            data: result,
        });
    } catch (error) {
        console.error('Error calculating match score:', error);

        if (error instanceof Error) {
            return NextResponse.json(
                { error: `Failed to calculate match score: ${error.message}` },
                { status: 500 }
            );
        }

        return NextResponse.json(
            { error: 'An unexpected error occurred while calculating the match score' },
            { status: 500 }
        );
    }
}
