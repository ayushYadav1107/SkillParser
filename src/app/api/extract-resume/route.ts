import { NextRequest, NextResponse } from 'next/server';
import { extractResumeInformation } from '@/ai/flows/extract-resume-information-flow';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { resumeDataUri } = body;

        // Input validation
        if (!resumeDataUri || typeof resumeDataUri !== 'string') {
            return NextResponse.json(
                { error: 'Resume data URI is required and must be a string' },
                { status: 400 }
            );
        }

        if (!resumeDataUri.startsWith('data:')) {
            return NextResponse.json(
                { error: 'Invalid resume data format' },
                { status: 400 }
            );
        }

        // Check file size (max 10MB)
        const byteLength = Buffer.byteLength(resumeDataUri, 'utf8');
        const maxSizeBytes = 10 * 1024 * 1024; // 10MB

        if (byteLength > maxSizeBytes) {
            return NextResponse.json(
                { error: 'Resume file is too large. Maximum size is 10MB' },
                { status: 400 }
            );
        }

        // Call Genkit flow
        const result = await extractResumeInformation({
            resumeDataUri,
        });

        return NextResponse.json({
            success: true,
            data: result,
        });
    } catch (error) {
        console.error('Error extracting resume information:', error);

        if (error instanceof Error) {
            return NextResponse.json(
                { error: `Failed to extract resume information: ${error.message}` },
                { status: 500 }
            );
        }

        return NextResponse.json(
            { error: 'An unexpected error occurred while processing the resume' },
            { status: 500 }
        );
    }
}
