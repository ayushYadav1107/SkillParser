import { NextRequest, NextResponse } from 'next/server';
import { extractResumeInformationDetailed } from '@/ai/flows/extract-resume-information-flow';

/**
 * The response now carries the telemetry the evaluation work depends on —
 * which provider and model actually answered, how long it took, how many tokens it
 * cost, and whether the request had to fall through the failover chain.
 *
 * Returning that rather than only the extraction is what makes the accuracy claim
 * checkable in production: a result served by the rule-based fallback during a
 * Gemini outage is a different thing from one served by Gemini, and a client that
 * cannot tell them apart will present both with the same confidence.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { resumeDataUri, useFewShot } = body;

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

        const result = await extractResumeInformationDetailed({
            resumeDataUri,
            useFewShot: typeof useFewShot === 'boolean' ? useFewShot : undefined,
        });

        return NextResponse.json({
            success: true,
            data: result.data,
            meta: {
                provider: result.providerId,
                model: result.modelId,
                latencyMs: result.latencyMs,
                promptTokens: result.promptTokens,
                completionTokens: result.completionTokens,
                degraded: result.degraded,
                failoverTrail: result.failoverTrail,
            },
        });
    } catch (error) {
        console.error('Error extracting resume information:', error);

        if (error instanceof Error) {
            // The message is already humanised by the flow, so it is safe and useful
            // to show verbatim.
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json(
            { error: 'An unexpected error occurred while processing the resume' },
            { status: 500 }
        );
    }
}
