"use client";

import React, { useState, useCallback, useMemo, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  FileUp,
  Trash2,
  FileSearch,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Download,
  Search,
  Users,
  Briefcase,
  LayoutDashboard,
  BrainCircuit,
  History,
  Info,
  ExternalLink,
  Zap,
  FileJson,
  FileText,
} from "lucide-react";
import { Candidate, JobAnalysis } from "@/lib/types";
import { ExtractResumeInformationOutput } from '@/ai/flows/extract-resume-information-flow';
import {
  analyzeJobDescription,
  extractResume,
  calculateMatchScore,
} from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";
import { useAnalysisHistory, AnalysisHistory } from "@/hooks/use-analysis-history";
import { useTalentPool } from "@/hooks/use-talent-pool";
import { useJobPostings } from "@/hooks/use-job-postings";
import {
  exportToCsv,
  exportToJson,
  generateCandidateReport,
} from "@/lib/export-utils";
import { cn } from "@/lib/utils";
import { TalentPoolTab } from "@/components/talent-pool-tab";
import { JobPostingsTab } from "@/components/job-postings-tab";
import { HistoryTab } from "@/components/history-tab";
import { useAuth } from "@/lib/auth";
import { saveResumeFile } from "@/lib/storage";

type SidebarTab = "active-match" | "talent-pool" | "job-postings" | "history";

export default function AnalyzerPage() {
  const { role, isLoaded } = useAuth();
  const { toast } = useToast();
  const { history, saveAnalysis, loadAnalysis, deleteAnalysis, clearHistory } = useAnalysisHistory();
  const { candidates: talentPoolCandidates, addCandidate: addToTalentPool, removeCandidate: removeFromTalentPool, toggleShortlist } = useTalentPool();
  const { postings, savePosting, deletePosting } = useJobPostings();
  const [activeTab, setActiveTab] = useState<SidebarTab>("active-match");
  const [jobAnalysis, setJobAnalysis] = useState<JobAnalysis>({
    title: "",
    description: "",
    keySkills: [],
    requiredExperience: [],
    essentialQualifications: [],
    status: "idle",
  });
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(
    null,
  );
  const [isProcessingAll, setIsProcessingAll] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Handler: Shortlist a candidate and add to talent pool
  const handleShortlist = useCallback((candidate: Candidate) => {
    if (!candidate.extractedInfo) return;
    const safeJobTitle = jobAnalysis.title || jobAnalysis.description.split('\n')[0]?.slice(0, 60) || 'Unknown Role';
    addToTalentPool({
      id: candidate.id, // Consistent unique ID
      name: candidate.name,
      fileName: candidate.fileName,
      skills: candidate.extractedInfo.skills || [],
      matchScore: candidate.matchResults?.matchScore,
      jobTitle: safeJobTitle,
      extractedInfo: candidate.extractedInfo,
      matchResults: candidate.matchResults,
      shortlisted: true,
    });
    toast({ title: "✓ Shortlisted", description: `${candidate.name} added to Talent Pool.` });
  }, [addToTalentPool, jobAnalysis.description, jobAnalysis.title, toast]);

  // Handler: Restore an analysis from history
  const handleRestoreHistory = useCallback((entry: AnalysisHistory) => {
    setJobAnalysis(entry.jobAnalysis);
    setCandidates(entry.candidates);
    setActiveCandidateId(entry.candidates[0]?.id || null);
    setActiveTab("active-match");
    toast({ title: "✓ Restored", description: "Analysis session restored to Active Match." });
  }, [toast]);

  // Default redirect for recruiters from active-match
  useEffect(() => {
    if (isLoaded && role === 'recruiter' && activeTab === 'active-match') {
      setActiveTab('talent-pool');
    }
  }, [isLoaded, role, activeTab]);

  // Handler: Load a JD from job postings into Active Match
  const handleLoadJDToMatch = useCallback((description: string, title?: string) => {
    setJobAnalysis(prev => ({ ...prev, title, description, status: "idle" }));
    setActiveTab("active-match");
    toast({ title: "✓ Loaded", description: "Job description loaded into Active Match." });
  }, [toast]);

  const handleJobDescriptionChange = (
    e: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    setJobAnalysis((prev) => ({
      ...prev,
      description: e.target.value,
      status: "idle",
    }));
  };

  const analyzeJD = async () => {
    if (!jobAnalysis.description.trim()) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please enter a job description.",
      });
      return;
    }

    setJobAnalysis((prev) => ({ ...prev, status: "analyzing" }));
    try {
      const response = await analyzeJobDescription(jobAnalysis.description);
      setJobAnalysis((prev) => ({
        ...prev,
        ...response.data,
        status: "completed",
      }));
      toast({
        title: "✓ JD Analyzed",
        description: "Requirements extracted successfully.",
      });
    } catch (error) {
      console.error(error);
      setJobAnalysis((prev) => ({ ...prev, status: "error" }));
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Could not analyze the job description";
      toast({
        variant: "destructive",
        title: "Analysis Failed",
        description: errorMessage,
      });
    }
  };

  const processCandidate = useCallback(
    async (candidateId: string, file: File) => {
      setCandidates((prev) =>
        prev.map((c) =>
          c.id === candidateId ? { ...c, status: "processing" } : c,
        ),
      );

      try {
        const reader = new FileReader();
        const dataUri = await new Promise<string>((resolve, reject) => {
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.onerror = (e) => reject(new Error("File reading failed"));
          reader.readAsDataURL(file);
        });

        const resumeResponse = await extractResume(dataUri);
        const extractedInfo = resumeResponse.data;

        let matchResults = undefined;
        if (
          jobAnalysis.status === "completed" ||
          jobAnalysis.description.length > 50
        ) {
          try {
            const matchResponse = await calculateMatchScore(
              JSON.stringify(extractedInfo),
              jobAnalysis.description,
              jobAnalysis.keySkills,
            );
            matchResults = matchResponse.data;
          } catch (matchError) {
            console.warn("Match score calculation failed:", matchError);
            // Continue with just resume extraction if matching fails
          }
        }

        setCandidates((prev) => 
          prev.map((c) =>
            c.id === candidateId
              ? { ...c, extractedInfo: extractedInfo as ExtractResumeInformationOutput, matchResults, status: "completed" as const }
              : c
          )
        );
        
        // Auto-add to talent pool reliably OUTSIDE the state setter
        const safeJobTitle = jobAnalysis.title || jobAnalysis.description.split('\n')[0]?.slice(0, 60) || 'Unknown Role';
        addToTalentPool({
          id: candidateId, // Use the unique session ID directly to avoid collisions
          name: file.name.split('.')[0],
          fileName: file.name,
          skills: extractedInfo?.skills || [],
          matchScore: matchResults?.matchScore,
          jobTitle: safeJobTitle,
          extractedInfo: extractedInfo as ExtractResumeInformationOutput,
          matchResults: matchResults,
          shortlisted: false,
        });

        // AUTO-SAVE to history for candidates so they don't lose sessions
        if (role === 'candidate') {
          saveAnalysis(jobAnalysis, [{
            id: candidateId,
            name: file.name.split('.')[0],
            fileName: file.name,
            status: "completed",
            extractedInfo: extractedInfo as ExtractResumeInformationOutput,
            matchResults: matchResults
          }], safeJobTitle);
        }
      } catch (error) {
        console.error(error);
        const errorMessage =
          error instanceof Error ? error.message : "Processing failed";
        setCandidates((prev) =>
          prev.map((c) =>
            c.id === candidateId ? { ...c, status: "error", errorMessage } : c,
          ),
        );
        toast({
          variant: "destructive",
          title: "Resume Processing Failed",
          description: errorMessage,
        });
      }
    },
    [jobAnalysis.description, jobAnalysis.status, jobAnalysis.keySkills, toast],
  );

  const onFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newCandidates: Candidate[] = Array.from(files).map((file) => ({
      id: Math.random().toString(36).substr(2, 9),
      name: file.name.split(".")[0],
      fileName: file.name,
      status: "idle",
    }));

    setCandidates((prev) => {
      const updated = [...prev, ...newCandidates];
      if (!activeCandidateId) setActiveCandidateId(newCandidates[0].id);
      return updated;
    });

    // Automatically trigger processing and save file to IndexDB for each file
    Array.from(files).forEach((file, index) => {
      saveResumeFile(newCandidates[index].id, file).catch(console.error);
      processCandidate(newCandidates[index].id, file);
    });
  };

  const processAll = async () => {
    setIsProcessingAll(true);
    const fileInput = document.getElementById(
      "resume-upload",
    ) as HTMLInputElement;
    const files = fileInput.files;

    if (!files) {
      setIsProcessingAll(false);
      return;
    }

    const pending = candidates.filter(
      (c) =>
        c.status === "idle" ||
        c.status === "error" ||
        c.status === "processing",
    );
    for (const candidate of pending) {
      const file = Array.from(files).find((f) => f.name === candidate.fileName);
      if (file) await processCandidate(candidate.id, file);
    }

    setIsProcessingAll(false);
    toast({
      title: "Processing Complete",
      description: "Candidates have been analyzed.",
    });
  };

  const deleteCandidate = (id: string) => {
    setCandidates((prev) => prev.filter((c) => c.id !== id));
    if (activeCandidateId === id) setActiveCandidateId(null);
  };

  const handleExportCsv = () => {
    if (candidates.length === 0) {
      toast({
        variant: "destructive",
        title: "No data",
        description: "Add candidates to export",
      });
      return;
    }
    exportToCsv(jobAnalysis, candidates);
    toast({ title: "✓ Exported", description: "Results exported as CSV" });
  };

  const handleExportJson = () => {
    if (candidates.length === 0) {
      toast({
        variant: "destructive",
        title: "No data",
        description: "Add candidates to export",
      });
      return;
    }
    exportToJson(jobAnalysis, candidates);
    toast({ title: "✓ Exported", description: "Results exported as JSON" });
  };

  const handleSaveAnalysis = () => {
    if (candidates.length === 0) {
      toast({
        variant: "destructive",
        title: "No data",
        description: "Add candidates to enable exporting.",
      });
      return;
    }
    // Also save to history so it's not completely lost for anyone
    saveAnalysis(jobAnalysis, candidates);
    
    // Trigger native browser PDF print
    window.print();
  };

  const handleDownloadReport = () => {
    if (!activeCandidate) return;
    const report = generateCandidateReport(activeCandidate);
    const blob = new Blob([report], { type: "text/plain" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${activeCandidate.name}-report.txt`;
    link.click();
    toast({
      title: "✓ Downloaded",
      description: "Candidate report downloaded",
    });
  };

  const sortedCandidates = useMemo(() => {
    return [...candidates].sort((a, b) => {
      const scoreA = a.matchResults?.matchScore ?? -1;
      const scoreB = b.matchResults?.matchScore ?? -1;
      return scoreB - scoreA;
    });
  }, [candidates]);

  const activeCandidate = candidates.find((c) => c.id === activeCandidateId);

  if (!isLoaded) return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="flex h-screen bg-background overflow-hidden print:bg-white print:h-auto print:overflow-visible">
      {/* Sidebar Navigation */}
      <aside className="hidden lg:flex w-64 bg-primary text-white flex-col shrink-0 print:hidden">
        <div className="p-6">
          <Link
            href="/"
            className="flex items-center gap-2 font-bold text-xl tracking-tight"
          >
            <BrainCircuit className="h-8 w-8 text-secondary" />
            <span>SkillParser</span>
          </Link>
        </div>

        <nav className="flex-1 px-4 py-4 space-y-1">
          <Button
            variant="ghost"
            className="w-full justify-start text-white hover:bg-white/20 hover:text-white"
            asChild
          >
            <Link href="/">
              <LayoutDashboard className="mr-3 h-5 w-5" /> Dashboard
            </Link>
          </Button>
          {role === 'candidate' && (
            <Button
              variant={activeTab === "active-match" ? "secondary" : "ghost"}
              className={cn(
                "w-full justify-start",
                activeTab === "active-match"
                  ? "font-semibold"
                  : "text-white/70 hover:bg-white/20 hover:text-white"
              )}
              onClick={() => setActiveTab("active-match")}
            >
              <FileSearch className="mr-3 h-5 w-5" /> Active Match
            </Button>
          )}

          {role === 'recruiter' && (
            <Button
              variant={activeTab === "talent-pool" ? "secondary" : "ghost"}
              className={cn(
                "w-full justify-start",
                activeTab === "talent-pool"
                  ? "font-semibold"
                  : "text-white/70 hover:bg-white/20 hover:text-white"
              )}
              onClick={() => setActiveTab("talent-pool")}
            >
              <Users className="mr-3 h-5 w-5" /> Talent Pool
            </Button>
          )}

          <Button
            variant={activeTab === "job-postings" ? "secondary" : "ghost"}
            className={cn(
              "w-full justify-start",
              activeTab === "job-postings"
                ? "font-semibold"
                : "text-white/70 hover:bg-white/20 hover:text-white"
            )}
            onClick={() => setActiveTab("job-postings")}
          >
            <Briefcase className="mr-3 h-5 w-5" /> Job Postings
          </Button>

          {role === 'candidate' && (
            <Button
              variant={activeTab === "history" ? "secondary" : "ghost"}
              className={cn(
                "w-full justify-start",
                activeTab === "history"
                  ? "font-semibold"
                  : "text-white/70 hover:bg-white/20 hover:text-white"
              )}
              onClick={() => setActiveTab("history")}
            >
              <History className="mr-3 h-5 w-5" /> History
            </Button>
          )}
        </nav>

        <div className="p-6 mt-auto">
          <div className="bg-white/10 rounded-xl p-4 text-xs text-white/60">
            <p className="font-semibold text-white mb-2 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-secondary flex items-center justify-center text-[8px] text-white">
                i
              </span>
              Pro Tip
            </p>
            Upload high-quality PDFs for 99% extraction accuracy.
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Talent Pool Tab */}
        {activeTab === "talent-pool" && (
          <TalentPoolTab
            candidates={talentPoolCandidates}
            onRemove={removeFromTalentPool}
            onToggleShortlist={toggleShortlist}
          />
        )}

        {/* Job Postings Tab */}
        {activeTab === "job-postings" && (
          <JobPostingsTab
            postings={postings}
            onSave={savePosting}
            onDelete={deletePosting}
            onLoadToMatch={handleLoadJDToMatch}
            readonly={role === "candidate"}
          />
        )}

        {/* History Tab */}
        {activeTab === "history" && role === "candidate" && (
          <HistoryTab
            history={history}
            onRestore={handleRestoreHistory}
            onDelete={deleteAnalysis}
            onClearAll={clearHistory}
          />
        )}

        {/* Active Match Tab - only render when active and for candidates */}
        {activeTab === "active-match" && role === "candidate" && (<>
        <header className="h-16 bg-white border-b flex items-center justify-between px-8 shrink-0">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold text-primary">
              Resume Matcher v1.2
            </h2>
            <Badge
              variant="outline"
              className="text-secondary border-secondary"
            >
              Beta Access
            </Badge>
          </div>
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              className="bg-primary text-white"
              onClick={handleSaveAnalysis}
              disabled={candidates.length === 0}
            >
              <Download className="mr-2 h-4 w-4" /> Save as PDF
            </Button>
          </div>
        </header>

        <main className="flex-1 overflow-hidden flex gap-0 print:block print:overflow-visible">
          {/* Middle Column: Controls & List */}
          <div className="w-[450px] md:w-96 lg:w-[450px] border-r bg-muted/30 flex flex-col shrink-0 max-w-[60vw] print:hidden">
            <ScrollArea className="flex-1">
              <div className="p-6 space-y-6">
                {/* Step 1: Job Description */}
                <section className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-primary text-white flex items-center justify-center text-[10px]">
                        1
                      </span>
                      Job Profile
                    </h3>
                    {jobAnalysis.status === "completed" && (
                      <Badge
                        variant="secondary"
                        className="bg-secondary/10 text-secondary border-none"
                      >
                        Analyzed
                      </Badge>
                    )}
                  </div>
                  <Card className="shadow-none border-border/50">
                    <CardContent className="p-4 space-y-4">
                      <Textarea
                        placeholder="Paste the Job Description here..."
                        className="min-h-[140px] resize-none text-sm bg-background border-none focus-visible:ring-1 focus-visible:ring-primary shadow-inner"
                        value={jobAnalysis.description}
                        onChange={handleJobDescriptionChange}
                      />
                      <Button
                        size="sm"
                        className="w-full bg-primary hover:bg-primary/90"
                        onClick={analyzeJD}
                        disabled={jobAnalysis.status === "analyzing"}
                      >
                        {jobAnalysis.status === "analyzing" ? (
                          <>
                            <Loader2 className="mr-2 h-3 w-3 animate-spin" />{" "}
                            Analyzing...
                          </>
                        ) : (
                          "Extract Requirements"
                        )}
                      </Button>

                      {jobAnalysis.status === "completed" &&
                        jobAnalysis.keySkills.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-2">
                            {jobAnalysis.keySkills.slice(0, 6).map((s, i) => (
                              <Badge
                                key={i}
                                variant="outline"
                                className="text-[10px] font-medium py-0 px-2 bg-muted/50"
                              >
                                {s}
                              </Badge>
                            ))}
                          </div>
                        )}
                    </CardContent>
                  </Card>
                </section>

                <Separator />

                {/* Step 2: Resumes */}
                <section className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-primary text-white flex items-center justify-center text-[10px]">
                        2
                      </span>
                      Candidates
                    </h3>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-[10px] text-primary h-6"
                        onClick={processAll}
                        disabled={isProcessingAll || candidates.length === 0}
                      >
                        {isProcessingAll ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          "Reprocess All"
                        )}
                      </Button>
                    </div>
                  </div>

                  <div className="grid w-full items-center gap-1.5">
                    <Label
                      htmlFor="resume-upload"
                      className="cursor-pointer border-2 border-dashed border-border rounded-xl p-6 hover:bg-white hover:border-primary/50 transition-all text-center flex flex-col items-center group"
                    >
                      <FileUp className="h-8 w-8 text-muted-foreground group-hover:text-primary transition-colors mb-2" />
                      <span className="text-sm font-semibold">
                        Drop Resumes Here
                      </span>
                      <span className="text-[10px] text-muted-foreground mt-1">
                        Accepts PDF & DOCX (Max 10)
                      </span>
                      <Input
                        id="resume-upload"
                        type="file"
                        multiple
                        className="hidden"
                        onChange={onFileUpload}
                        accept=".pdf,.docx"
                      />
                    </Label>
                  </div>

                  <div className="space-y-2 pt-2">
                    {sortedCandidates.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground italic text-sm">
                        No candidates loaded yet.
                      </div>
                    ) : (
                      sortedCandidates.map((candidate) => (
                        <div
                          key={candidate.id}
                          className={cn(
                            "group flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer relative overflow-hidden",
                            activeCandidateId === candidate.id
                              ? "border-primary bg-white ring-1 ring-primary/20"
                              : "border-transparent bg-white hover:border-muted-foreground/20 hover:shadow-sm",
                          )}
                          onClick={() => setActiveCandidateId(candidate.id)}
                        >
                          <div
                            className={cn(
                              "w-10 h-10 rounded-lg flex items-center justify-center font-bold text-white shrink-0 text-sm",
                              candidate.status === "completed"
                                ? "score-gradient"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {candidate.matchResults?.matchScore ?? "--"}
                          </div>

                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold truncate text-primary">
                              {candidate.name}
                            </p>
                            <div className="text-[10px] text-muted-foreground truncate flex items-center gap-1">
                              {candidate.status === "completed" && (
                                <CheckCircle2 className="h-3 w-3 text-secondary" />
                              )}
                              {candidate.status === "processing" && (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              )}
                              {candidate.status === "error" && (
                                <AlertCircle className="h-3 w-3 text-destructive" />
                              )}
                              {candidate.status === "idle" && (
                                <History className="h-3 w-3" />
                              )}
                              <span className="truncate">
                                {candidate.fileName}
                              </span>
                            </div>
                          </div>

                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 opacity-0 group-hover:opacity-100 text-destructive hover:bg-destructive/10 shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteCandidate(candidate.id);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </div>
            </ScrollArea>
          </div>

          {/* Right Column: Deep Analysis */}
          <div className="flex-1 bg-white relative">
            {activeCandidate ? (
              <ScrollArea className="h-full">
                <div className="p-8 max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  {/* Result Header */}
                  <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b pb-8">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Badge
                          className={cn(
                            "border-none hover:opacity-80",
                            activeCandidate.status === "completed"
                              ? "bg-secondary/10 text-secondary"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {activeCandidate.status === "completed"
                            ? "Analysis Complete"
                            : "In Progress"}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">
                          Candidate Report
                        </span>
                      </div>
                      <h1 className="text-4xl font-black text-primary tracking-tight">
                        {activeCandidate.name}
                      </h1>
                      {/* Role info removed as requested */}
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">
                          Match Quality
                        </p>
                        <div className="flex items-baseline gap-1">
                          <span className="text-5xl font-black text-primary">
                            {activeCandidate.matchResults?.matchScore ?? "--"}
                          </span>
                          <span className="text-muted-foreground font-bold">
                            %
                          </span>
                        </div>
                      </div>
                      <div className="h-16 w-[1px] bg-border hidden md:block" />
                      <div className="flex gap-2 print:hidden">
                        <Button
                          size="icon"
                          variant="outline"
                          className="rounded-full h-10 w-10"
                          onClick={handleDownloadReport}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        {/* Shortlist button removed here as this is now candidate-only view */}
                      </div>
                    </div>
                  </div>

                  {activeCandidate.status === "completed" ? (
                    <Tabs defaultValue="insights" className="w-full">
                      <TabsList className="bg-muted/50 p-1 rounded-xl mb-6">
                        <TabsTrigger
                          value="insights"
                          className="rounded-lg px-8"
                        >
                          AI Insights
                        </TabsTrigger>
                        <TabsTrigger
                          value="experience"
                          className="rounded-lg px-8"
                        >
                          Experience Map
                        </TabsTrigger>
                        <TabsTrigger value="gaps" className="rounded-lg px-8">
                          Gap Analysis
                        </TabsTrigger>
                      </TabsList>

                      <TabsContent value="insights" className="space-y-6">
                        <Card className="border-none shadow-sm bg-muted/20">
                          <CardHeader className="pb-2">
                            <CardTitle className="text-lg flex items-center gap-2">
                              <BrainCircuit className="h-5 w-5 text-primary" />
                              Strategic Assessment
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            {activeCandidate.matchResults ? (
                              <p className="text-sm leading-relaxed text-muted-foreground italic">
                                "{activeCandidate.matchResults.reasons}"
                              </p>
                            ) : (
                              <div className="p-6 text-center border-2 border-dashed rounded-xl">
                                <Zap className="h-8 w-8 text-secondary mx-auto mb-2 opacity-50" />
                                <p className="text-sm font-medium">
                                  Add a Job Description to see matching
                                  insights.
                                </p>
                              </div>
                            )}
                          </CardContent>
                        </Card>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <Card className="border-border/50 shadow-none">
                            <CardHeader className="pb-2">
                              <CardTitle className="text-sm font-bold flex items-center gap-2 text-secondary">
                                <CheckCircle2 className="h-4 w-4" /> Key
                                Strengths
                              </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2">
                              {activeCandidate.matchResults?.matchedSkills
                                .length ? (
                                activeCandidate.matchResults.matchedSkills.map(
                                  (s, i) => (
                                    <div
                                      key={i}
                                      className="text-xs p-2.5 bg-secondary/5 rounded-lg border border-secondary/10 flex items-center gap-2"
                                    >
                                      <div className="w-1.5 h-1.5 rounded-full bg-secondary" />
                                      {s}
                                    </div>
                                  ),
                                )
                              ) : (
                                <p className="text-xs text-muted-foreground italic">
                                  Waiting for matching...
                                </p>
                              )}
                            </CardContent>
                          </Card>

                          <Card className="border-border/50 shadow-none">
                            <CardHeader className="pb-2">
                              <CardTitle className="text-sm font-bold flex items-center gap-2 text-primary">
                                <Search className="h-4 w-4" /> Skill Inventory
                              </CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="flex flex-wrap gap-2">
                                {activeCandidate.extractedInfo?.skills.map(
                                  (s, i) => (
                                    <Badge
                                      key={i}
                                      variant="secondary"
                                      className="bg-muted text-muted-foreground border-none font-medium"
                                    >
                                      {s}
                                    </Badge>
                                  ),
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        </div>
                      </TabsContent>

                      <TabsContent value="experience" className="space-y-6">
                        <div className="relative pl-8 space-y-8 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[2px] before:bg-muted">
                          {activeCandidate.extractedInfo?.experience.map(
                            (exp, i) => (
                              <div key={i} className="relative">
                                <div className="absolute left-[-25px] top-1.5 w-6 h-6 rounded-full bg-white border-2 border-primary flex items-center justify-center">
                                  <div className="w-2 h-2 rounded-full bg-primary" />
                                </div>
                                <div className="bg-white p-5 rounded-xl border border-border/50 shadow-sm hover:shadow-md transition-shadow">
                                  <div className="flex justify-between items-start mb-2">
                                    <h4 className="font-bold text-primary text-lg">
                                      {exp.title}
                                    </h4>
                                    <Badge
                                      variant="outline"
                                      className="text-[10px]"
                                    >
                                      {exp.duration}
                                    </Badge>
                                  </div>
                                  <p className="text-secondary font-semibold text-sm mb-3">
                                    {exp.company}
                                  </p>
                                  <p className="text-sm text-muted-foreground leading-relaxed">
                                    {exp.description}
                                  </p>
                                </div>
                              </div>
                            ),
                          )}
                        </div>

                        <div className="pt-4">
                          <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">
                            Education & Training
                          </h4>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {activeCandidate.extractedInfo?.education.map(
                              (edu, i) => (
                                <Card
                                  key={i}
                                  className="shadow-none border-border/50 bg-muted/10"
                                >
                                  <CardContent className="p-4">
                                    <p className="font-bold text-primary text-sm">
                                      {edu.degree}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {edu.institution} • {edu.graduationDate}
                                    </p>
                                  </CardContent>
                                </Card>
                              ),
                            )}
                          </div>
                        </div>
                      </TabsContent>

                      <TabsContent value="gaps" className="space-y-6">
                        <Card className="border-none shadow-sm bg-destructive/5 overflow-hidden">
                          <div className="bg-destructive p-4 text-white flex items-center gap-2">
                            <AlertCircle className="h-5 w-5" />
                            <span className="font-bold">
                              Missing Qualifications
                            </span>
                          </div>
                          <CardContent className="p-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {!activeCandidate.matchResults ? (
                                <p className="text-sm italic text-muted-foreground col-span-2">
                                  Provide job context for gap analysis.
                                </p>
                              ) : activeCandidate.matchResults.missingSkills
                                  .length === 0 ? (
                                <p className="text-sm italic text-muted-foreground col-span-2">
                                  Perfect match. No missing skills identified.
                                </p>
                              ) : (
                                activeCandidate.matchResults.missingSkills.map(
                                  (s, i) => (
                                    <div
                                      key={i}
                                      className="flex items-center gap-3 p-3 bg-white rounded-xl border border-destructive/10 shadow-sm"
                                    >
                                      <div className="w-2 h-2 rounded-full bg-destructive" />
                                      <span className="text-sm font-medium">
                                        {s}
                                      </span>
                                    </div>
                                  ),
                                )
                              )}
                            </div>
                          </CardContent>
                        </Card>

                        <div className="p-6 rounded-xl border-2 border-dashed border-muted text-center">
                          <h4 className="font-bold text-primary mb-2">
                            Need to verify?
                          </h4>
                          <p className="text-sm text-muted-foreground mb-4">
                            Generate targeted interview questions based on these
                            gaps.
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!activeCandidate.matchResults}
                          >
                            Generate Interview Guide
                          </Button>
                        </div>
                      </TabsContent>
                    </Tabs>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-32 text-center space-y-4">
                      <div className="relative">
                        <div className="w-16 h-16 rounded-full border-4 border-muted border-t-primary animate-spin" />
                        <BrainCircuit className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-6 w-6 text-primary" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-primary">
                          {activeCandidate.status === "processing"
                            ? "AI Thinking..."
                            : "Ready to Analyze"}
                        </h3>
                        <p className="text-muted-foreground text-sm max-w-xs mx-auto">
                          {activeCandidate.status === "processing"
                            ? "Our LLM is currently cross-referencing candidate credentials with your job requirements."
                            : 'This candidate is in queue. Click "Run All" or wait for automatic processing.'}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
            ) : (
              <div className="h-full flex flex-col items-center justify-center p-12 text-center">
                <div className="bg-muted p-6 rounded-full mb-6">
                  <LayoutDashboard className="h-16 w-16 text-muted-foreground/50" />
                </div>
                <h2 className="text-2xl font-black text-primary mb-2">
                  Ready to screen?
                </h2>
                <p className="text-muted-foreground max-w-sm mx-auto mb-8">
                  Upload candidate resumes and provide a job description to see
                  advanced semantic matching in action.
                </p>
                <div className="flex gap-3">
                  <Button variant="outline" className="rounded-full">
                    View Demo
                  </Button>
                  <Button
                    className="rounded-full bg-primary"
                    onClick={() =>
                      document.getElementById("resume-upload")?.click()
                    }
                  >
                    Upload First Resume
                  </Button>
                </div>
              </div>
            )}
          </div>
        </main>
        </>)}
      </div>
    </div>
  );
}
