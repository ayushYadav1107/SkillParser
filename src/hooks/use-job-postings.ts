import { useState, useEffect, useCallback } from 'react';

export interface JobPosting {
  id: string;
  title: string;
  description: string;
  keySkills: string[];
  department?: string;
  location?: string;
  type?: string;
  createdAt: number;
  candidateCount: number;
}

const STORAGE_KEY = 'saved-job-postings';

export function useJobPostings() {
  const [postings, setPostings] = useState<JobPosting[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setPostings(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Failed to load job postings:', error);
    }
  }, []);

  const savePosting = useCallback((posting: Omit<JobPosting, 'id' | 'createdAt' | 'candidateCount'>) => {
    const newPosting: JobPosting = {
      ...posting,
      id: `job-${Date.now()}`,
      createdAt: Date.now(),
      candidateCount: 0,
    };
    setPostings(prev => {
      const updated = [newPosting, ...prev];
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch {}
      return updated;
    });
    return newPosting.id;
  }, []);

  const deletePosting = useCallback((id: string) => {
    setPostings(prev => {
      const updated = prev.filter(p => p.id !== id);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, []);

  const updateCandidateCount = useCallback((id: string, count: number) => {
    setPostings(prev => {
      const updated = prev.map(p => p.id === id ? { ...p, candidateCount: count } : p);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, []);

  return { postings, savePosting, deletePosting, updateCandidateCount };
}
