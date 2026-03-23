import { NextRequest, NextResponse } from 'next/server';
import { extractJobDescriptionRequirements } from '@/ai/flows/extract-job-description-requirements';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { jobDescription } = body;

        // Input validation
        if (!jobDescription || typeof jobDescription !== 'string') {
            return NextResponse.json(
                { error: 'Job description is required and must be a string' },
                { status: 400 }
            );
        }

        if (jobDescription.trim().length < 50) {
            return NextResponse.json(
                { error: 'Job description must be at least 50 characters long' },
                { status: 400 }
            );
        }

        if (jobDescription.trim().length > 10000) {
            return NextResponse.json(
                { error: 'Job description must not exceed 10,000 characters' },
                { status: 400 }
            );
        }

        // Call Genkit flow
        const result = await extractJobDescriptionRequirements({
            jobDescription: jobDescription.trim(),
        });

        return NextResponse.json({
            success: true,
            data: result,
        });
    } catch (error) {
        console.error('Error analyzing job description:', error);

        if (error instanceof Error) {
            return NextResponse.json(
                { error: `Failed to analyze job description: ${error.message}` },
                { status: 500 }
            );
        }

        return NextResponse.json(
            { error: 'An unexpected error occurred while analyzing the job description' },
            { status: 500 }
        );
    }
}
