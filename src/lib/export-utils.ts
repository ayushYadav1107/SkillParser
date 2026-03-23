import { Candidate, JobAnalysis } from '@/lib/types';

export function exportToCsv(
    jobAnalysis: JobAnalysis,
    candidates: Candidate[],
    filename = 'resume-screening-results.csv'
) {
    const headers = [
        'Candidate Name',
        'Status',
        'Match Score',
        'Current Position',
        'Skills',
        'Missing Skills',
        'Strategic Assessment',
        'Resume File',
    ];

    const rows = candidates.map(candidate => {
        const matchScore = candidate.matchResults?.matchScore;
        const currentPosition = candidate.extractedInfo?.experience?.[0]?.title;
        const skills = candidate.extractedInfo?.skills;
        const missingSkills = candidate.matchResults?.missingSkills;
        const assessment = candidate.matchResults?.reasons;

        return [
            candidate.name || 'N/A',
            candidate.status || 'N/A',
            matchScore !== undefined ? matchScore.toFixed(1) : 'N/A',
            currentPosition || 'N/A',
            Array.isArray(skills) ? skills.join('; ') : 'N/A',
            Array.isArray(missingSkills) ? missingSkills.join('; ') : 'N/A',
            assessment || 'N/A',
            candidate.fileName || 'N/A',
        ];
    });

    // Escape CSV fields
    const escapeCsvField = (field: string | number): string => {
        if (field === undefined || field === null) return '';
        const str = String(field);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    };

    const csvContent = [
        `Job Title: ${jobAnalysis.description ? jobAnalysis.description.split('\n')[0] : 'N/A'}`,
        `Analysis Date: ${new Date().toLocaleString()}`,
        '',
        'JOB ANALYSIS',
        `Key Skills: ${jobAnalysis.keySkills?.join(', ') || 'N/A'}`,
        `Required Experience: ${jobAnalysis.requiredExperience?.join(', ') || 'N/A'}`,
        `Essential Qualifications: ${jobAnalysis.essentialQualifications?.join(', ') || 'N/A'}`,
        '',
        'CANDIDATES',
        headers.map(escapeCsvField).join(','),
        ...rows.map(row => row.map(escapeCsvField).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
}

export function exportToJson(
    jobAnalysis: JobAnalysis,
    candidates: Candidate[],
    filename = 'resume-screening-results.json'
) {
    const data = {
        exportDate: new Date().toISOString(),
        jobAnalysis,
        candidates: candidates.map(c => ({
            id: c.id,
            name: c.name,
            fileName: c.fileName,
            status: c.status,
            matchScore: c.matchResults?.matchScore,
            strategicAssessment: c.matchResults?.reasons,
            extractedInfo: c.extractedInfo,
        })),
        summary: {
            totalCandidates: candidates.length,
            averageMatchScore: candidates.length > 0
                ? candidates.reduce((sum, c) => sum + (c.matchResults?.matchScore || 0), 0) / candidates.length
                : 0,
            topCandidates: candidates
                .filter(c => c.matchResults?.matchScore && c.matchResults.matchScore > 75)
                .sort((a, b) => (b.matchResults?.matchScore || 0) - (a.matchResults?.matchScore || 0))
                .slice(0, 5),
        },
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
}

export function generateCandidateReport(candidate: Candidate): string {
    const skills = candidate.extractedInfo?.skills || [];
    const missingSkills = candidate.matchResults?.missingSkills || [];
    const currentPosition = candidate.extractedInfo?.experience?.[0]?.title || 'N/A';

    return `
CANDIDATE ANALYSIS REPORT
========================================

Name: ${candidate.name || 'N/A'}
Current Position: ${currentPosition}
Resume File: ${candidate.fileName || 'N/A'}

MATCH SCORE: ${candidate.matchResults?.matchScore ? candidate.matchResults.matchScore.toFixed(1) + '%' : 'N/A'}

SKILLS:
${skills.length > 0
            ? skills.map((skill: string) => `  • ${skill}`).join('\n')
            : '  No skills found'}

MISSING SKILLS:
${missingSkills.length > 0
            ? missingSkills.map((skill: string) => `  • ${skill}`).join('\n')
            : '  No missing skills'}

STRATEGIC ASSESSMENT:
${candidate.matchResults?.reasons || 'No assessment available'}

========================================
Generated: ${new Date().toLocaleString()}
`;
}
