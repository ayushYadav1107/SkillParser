import { useState, useEffect, useCallback } from 'react';
import { ExtractResumeInformationOutput } from '@/ai/flows/extract-resume-information-flow';
import { CalculateResumeMatchScoreOutput } from '@/ai/flows/calculate-resume-match-score';

export interface TalentPoolCandidate {
  id: string; // Composite key: ${fileName}-${jobTitle}
  name: string;
  fileName: string;
  skills: string[];
  matchScore?: number;
  jobTitle?: string;
  extractedInfo?: ExtractResumeInformationOutput;
  matchResults?: CalculateResumeMatchScoreOutput;
  shortlisted: boolean;
  addedAt: number;
}

const STORAGE_KEY = 'talent-pool-candidates';

export function useTalentPool() {
  const [candidates, setCandidates] = useState<TalentPoolCandidate[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setCandidates(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Failed to load talent pool:', error);
    }
  }, []);

  const persist = useCallback((updated: TalentPoolCandidate[]) => {
    setCandidates(updated);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (error) {
      console.error('Failed to save talent pool:', error);
    }
  }, []);

  const addCandidate = useCallback((candidate: Omit<TalentPoolCandidate, 'addedAt'>) => {
    setCandidates(prev => {
      const existingIdx = prev.findIndex(c => c.id === candidate.id);
      let updated;
      if (existingIdx >= 0) {
        // Upsert: update existing entry but keep its original addedAt timestamp and shortlisted status if we aren't explicitly commanding otherwise.
        updated = [...prev];
        updated[existingIdx] = { 
          ...updated[existingIdx], 
          ...candidate, 
          // If the previous one was shortlisted, keep it shortlisted unless the new command says NO. Wait, the new payload always has shortlisted: false for auto-adds, so we MUST preserve existing shortlisted status!
          shortlisted: updated[existingIdx].shortlisted || candidate.shortlisted 
        };
      } else {
        // Prepend new entry
        updated = [{ ...candidate, addedAt: Date.now() }, ...prev];
      }
      
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, []);

  const removeCandidate = useCallback((id: string) => {
    setCandidates(prev => {
      const updated = prev.filter(c => c.id !== id);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, []);

  const toggleShortlist = useCallback((id: string) => {
    setCandidates(prev => {
      const updated = prev.map(c => c.id === id ? { ...c, shortlisted: !c.shortlisted } : c);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, []);

  return { candidates, addCandidate, removeCandidate, toggleShortlist };
}
