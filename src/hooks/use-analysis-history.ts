import { useState, useEffect } from 'react';
import { Candidate, JobAnalysis } from '@/lib/types';

export interface AnalysisHistory {
    id: string;
    timestamp: number;
    jobTitle?: string;
    jobAnalysis: JobAnalysis;
    candidates: Candidate[];
}

import { USER_EMAIL_KEY } from '@/lib/auth';

const getStorageKey = () => {
    try {
        const email = localStorage.getItem(USER_EMAIL_KEY);
        return email ? `resume-screener-history-${email}` : 'resume-screener-history-guest';
    } catch {
        return 'resume-screener-history-guest';
    }
};

const MAX_HISTORY_ITEMS = 20;

export function useAnalysisHistory() {
    const [history, setHistory] = useState<AnalysisHistory[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Load history from localStorage on mount
    useEffect(() => {
        try {
            const key = getStorageKey();
            const stored = localStorage.getItem(key);
            if (stored) {
                const parsed = JSON.parse(stored) as AnalysisHistory[];
                setHistory(parsed);
            }
        } catch (error) {
            console.error('Failed to load analysis history:', error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const saveAnalysis = (
        jobAnalysis: JobAnalysis,
        candidates: Candidate[],
        jobTitle?: string
    ): string => {
        const id = `analysis-${Date.now()}`;
        const newEntry: AnalysisHistory = {
            id,
            timestamp: Date.now(),
            jobTitle,
            jobAnalysis,
            candidates,
        };

        const updated = [newEntry, ...history].slice(0, MAX_HISTORY_ITEMS);
        setHistory(updated);

        try {
            const key = getStorageKey();
            localStorage.setItem(key, JSON.stringify(updated));
        } catch (error) {
            console.error('Failed to save analysis history:', error);
        }

        return id;
    };

    const loadAnalysis = (id: string): AnalysisHistory | undefined => {
        return history.find(item => item.id === id);
    };

    const deleteAnalysis = (id: string) => {
        const updated = history.filter(item => item.id !== id);
        setHistory(updated);

        try {
            const key = getStorageKey();
            localStorage.setItem(key, JSON.stringify(updated));
        } catch (error) {
            console.error('Failed to delete analysis history:', error);
        }
    };

    const clearHistory = () => {
        setHistory([]);
        try {
            const key = getStorageKey();
            localStorage.removeItem(key);
        } catch (error) {
            console.error('Failed to clear analysis history:', error);
        }
    };

    return {
        history,
        isLoading,
        saveAnalysis,
        loadAnalysis,
        deleteAnalysis,
        clearHistory,
    };
}
