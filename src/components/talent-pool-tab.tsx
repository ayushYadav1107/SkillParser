"use client";

import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Users,
  Search,
  Star,
  StarOff,
  Trash2,
  UserPlus,
  CheckCircle2,
  AlertCircle,
  BrainCircuit,
  Briefcase,
  Calendar,
  X,
  Award,
  Tag,
  FileText,
  Download,
} from "lucide-react";
import { TalentPoolCandidate } from "@/hooks/use-talent-pool";
import { getResumeFile } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface TalentPoolTabProps {
  candidates: TalentPoolCandidate[];
  onRemove: (id: string) => void;
  onToggleShortlist: (id: string) => void;
}

export function TalentPoolTab({
  candidates,
  onRemove,
  onToggleShortlist,
}: TalentPoolTabProps) {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "shortlisted">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleDownloadResume = async (candidateId: string, fileName: string) => {
    try {
      // The candidate might be prefixed with 'tp-', so we try to extract the original ID if possible
      let idToFetch = candidateId;
      if (candidateId.startsWith('tp-')) {
        const parts = candidateId.split('-');
        if (parts.length >= 3) {
          idToFetch = parts[1]; // The original candidate ID
        }
      }

      const file = await getResumeFile(idToFetch);
      if (!file) {
        toast({ variant: "destructive", title: "File Not Found", description: "Original resume file is no longer available in this browser storage." });
        return;
      }
      
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Could not download the resume." });
    }
  };

  const filteredCandidates = useMemo(() => {
    let result = candidates;
    if (filterMode === "shortlisted") {
      result = result.filter((c) => c.shortlisted);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.skills.some((s) => s.toLowerCase().includes(q)) ||
          (c.jobTitle && c.jobTitle.toLowerCase().includes(q))
      );
    }
    return result;
  }, [candidates, searchQuery, filterMode]);

  const shortlistedCount = candidates.filter((c) => c.shortlisted).length;
  const selectedCandidate = candidates.find((c) => c.id === selectedId);

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <header className="h-16 bg-white border-b flex items-center justify-between px-8 shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-primary">Talent Pool</h2>
          <Badge variant="outline" className="text-secondary border-secondary">
            {candidates.length} Candidates
          </Badge>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: candidate list */}
        <div className="flex-1 flex flex-col min-w-0">
          <ScrollArea className="flex-1">
            <div className="p-8 space-y-6">
              {/* Stats Row */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="border-border/50 shadow-none bg-gradient-to-br from-primary/5 to-transparent">
                  <CardContent className="p-5 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                      <Users className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <p className="text-2xl font-black text-primary">{candidates.length}</p>
                      <p className="text-xs text-muted-foreground font-medium">Total Candidates</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-border/50 shadow-none bg-gradient-to-br from-secondary/5 to-transparent">
                  <CardContent className="p-5 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-secondary/10 flex items-center justify-center">
                      <Star className="h-6 w-6 text-secondary" />
                    </div>
                    <div>
                      <p className="text-2xl font-black text-secondary">{shortlistedCount}</p>
                      <p className="text-xs text-muted-foreground font-medium">Shortlisted</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-border/50 shadow-none bg-gradient-to-br from-blue-500/5 to-transparent">
                  <CardContent className="p-5 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center">
                      <BrainCircuit className="h-6 w-6 text-blue-500" />
                    </div>
                    <div>
                      <p className="text-2xl font-black text-blue-600">
                        {candidates.length > 0
                          ? (() => {
                              const scored = candidates.filter(c => c.matchScore != null);
                              return scored.length > 0
                                ? Math.round(scored.reduce((acc, c) => acc + (c.matchScore ?? 0), 0) / scored.length)
                                : "--";
                            })()
                          : "--"}
                        {candidates.some(c => c.matchScore != null) && (
                          <span className="text-sm font-medium text-muted-foreground">%</span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground font-medium">Avg Match Score</p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Search & Filter */}
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name, skill, or role..."
                    className="pl-10 bg-white"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <Button
                  variant={filterMode === "all" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilterMode("all")}
                  className={cn(filterMode === "all" && "bg-primary")}
                >
                  All
                </Button>
                <Button
                  variant={filterMode === "shortlisted" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilterMode("shortlisted")}
                  className={cn(filterMode === "shortlisted" && "bg-secondary")}
                >
                  <Star className="mr-1.5 h-3.5 w-3.5" />
                  Shortlisted
                </Button>
              </div>

              {/* Candidate Grid */}
              {filteredCandidates.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
                  <div className="bg-muted p-6 rounded-full">
                    <UserPlus className="h-12 w-12 text-muted-foreground/50" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-primary mb-2">
                      {candidates.length === 0
                        ? "No candidates yet"
                        : "No matching candidates"}
                    </h3>
                    <p className="text-muted-foreground max-w-sm mx-auto text-sm">
                      {candidates.length === 0
                        ? "Candidates you shortlist from Active Match will appear here for easy access across sessions."
                        : "Try adjusting your search or filter criteria."}
                    </p>
                  </div>
                </div>
              ) : (
                <div className={cn(
                  "grid gap-4",
                  selectedCandidate ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2"
                )}>
                  {filteredCandidates.map((candidate) => (
                    <Card
                      key={candidate.id}
                      className={cn(
                        "border-border/50 shadow-sm hover:shadow-md transition-all group overflow-hidden cursor-pointer",
                        selectedId === candidate.id && "ring-2 ring-primary border-primary"
                      )}
                      onClick={() => setSelectedId(selectedId === candidate.id ? null : candidate.id)}
                    >
                      <CardContent className="p-5">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <div
                              className={cn(
                                "w-11 h-11 rounded-xl flex items-center justify-center font-bold text-white text-sm shrink-0",
                                candidate.matchScore != null
                                  ? "score-gradient"
                                  : "bg-muted text-muted-foreground"
                              )}
                            >
                              {candidate.matchScore ?? "--"}
                            </div>
                            <div>
                              <h4 className="font-bold text-primary text-sm">
                                {candidate.name}
                              </h4>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className={cn(
                                "h-8 w-8",
                                candidate.shortlisted
                                  ? "text-amber-500"
                                  : "text-muted-foreground opacity-0 group-hover:opacity-100"
                              )}
                              onClick={(e) => { e.stopPropagation(); onToggleShortlist(candidate.id); }}
                            >
                              {candidate.shortlisted ? (
                                <Star className="h-4 w-4 fill-current" />
                              ) : (
                                <StarOff className="h-4 w-4" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 hover:bg-destructive/10"
                              onClick={(e) => { e.stopPropagation(); onRemove(candidate.id); }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>

                        {candidate.skills.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mb-3">
                            {candidate.skills.slice(0, 5).map((skill, i) => (
                              <Badge
                                key={i}
                                variant="secondary"
                                className="bg-muted text-muted-foreground border-none font-medium text-[10px] py-0"
                              >
                                {skill}
                              </Badge>
                            ))}
                            {candidate.skills.length > 5 && (
                              <Badge
                                variant="outline"
                                className="text-[10px] py-0"
                              >
                                +{candidate.skills.length - 5}
                              </Badge>
                            )}
                          </div>
                        )}

                        <div className="flex items-center justify-between pt-2 border-t border-border/50">
                          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            Added {new Date(candidate.addedAt).toLocaleDateString()}
                          </p>
                          {candidate.jobTitle && (
                            <Badge variant="outline" className="text-[10px] py-0">
                              {candidate.jobTitle}
                            </Badge>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Candidate Detail Modal */}
        <Dialog open={!!selectedCandidate} onOpenChange={(open) => !open && setSelectedId(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] p-0 overflow-hidden flex flex-col border-none bg-background sm:rounded-2xl gap-0">
            {selectedCandidate && (
              <>
                <DialogHeader className="bg-white p-6 md:p-8 border-b shrink-0 text-left">
                  <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest mb-1">
                    Candidate Details
                  </p>
                  <DialogTitle className="text-3xl font-black text-primary tracking-tight">
                    {selectedCandidate.name}
                  </DialogTitle>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto min-h-0 bg-muted/10 pb-6">
                  <div className="p-6 md:p-8 space-y-8">
                    {/* Score Card */}
                    <Card className="border-none shadow-sm bg-gradient-to-br from-primary/5 via-secondary/5 to-transparent">
                      <CardContent className="p-6 md:p-8 flex items-center justify-between">
                        <div>
                          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
                            Match Score
                          </p>
                          <div className="flex items-baseline gap-1">
                            <span className="text-6xl font-black text-primary">
                              {selectedCandidate.matchScore ?? "--"}
                            </span>
                            {selectedCandidate.matchScore != null && (
                              <span className="text-muted-foreground font-bold text-xl">%</span>
                            )}
                          </div>
                        </div>
                        <div
                          className={cn(
                            "w-24 h-24 rounded-3xl flex items-center justify-center font-bold text-white text-4xl shadow-inner",
                            selectedCandidate.matchScore != null
                              ? "score-gradient"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          {selectedCandidate.matchScore ?? "--"}
                        </div>
                      </CardContent>
                    </Card>

                    {/* Status & Actions Row */}
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        {selectedCandidate.shortlisted && (
                          <Badge className="bg-amber-500/10 text-amber-600 border-none gap-1 px-3 py-1.5 text-sm">
                            <Star className="h-4 w-4 fill-current" /> Shortlisted
                          </Badge>
                        )}
                        <Badge variant="outline" className="gap-1 px-3 py-1.5 text-sm">
                          <FileText className="h-4 w-4" />
                          {selectedCandidate.fileName}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          className="bg-secondary text-secondary-foreground hover:bg-secondary/90 border-secondary px-6"
                          onClick={() => handleDownloadResume(selectedCandidate.id, selectedCandidate.fileName)}
                        >
                          <Download className="mr-2 h-4 w-4" /> Download Resume
                        </Button>
                      </div>
                    </div>

                    <Separator />

                    <Tabs defaultValue="insights" className="w-full mt-6">
                      <TabsList className="bg-muted/50 p-1 rounded-xl mb-6 flex overflow-x-auto">
                        <TabsTrigger value="insights" className="rounded-lg px-6 shrink-0">AI Insights</TabsTrigger>
                        <TabsTrigger value="experience" className="rounded-lg px-6 shrink-0">Experience Map</TabsTrigger>
                        <TabsTrigger value="gaps" className="rounded-lg px-6 shrink-0">Gap Analysis</TabsTrigger>
                        <TabsTrigger value="details" className="rounded-lg px-6 shrink-0">Metadata</TabsTrigger>
                      </TabsList>

                      <TabsContent value="insights" className="space-y-6">
                        {/* Strategic Assessment & Skills */}
                        <Card className="border-none shadow-sm bg-muted/20">
                          <CardHeader className="pb-2">
                            <CardTitle className="text-lg flex items-center gap-2">
                              <BrainCircuit className="h-5 w-5 text-primary" />
                              Strategic Assessment
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            {selectedCandidate.matchResults ? (
                              <p className="text-sm leading-relaxed text-muted-foreground italic">
                                "{selectedCandidate.matchResults.reasons}"
                              </p>
                            ) : (
                              <div className="p-6 text-center border-2 border-dashed rounded-xl border-muted">
                                <p className="text-sm font-medium text-muted-foreground">No matching insights available for this candidate.</p>
                              </div>
                            )}
                          </CardContent>
                        </Card>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <Card className="border-border/50 shadow-none">
                            <CardHeader className="pb-2">
                              <CardTitle className="text-sm font-bold flex items-center gap-2 text-secondary">
                                <CheckCircle2 className="h-4 w-4" /> Key Strengths
                              </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2">
                              {selectedCandidate.matchResults?.matchedSkills?.length ? (
                                selectedCandidate.matchResults.matchedSkills.map((s, i) => (
                                  <div key={i} className="text-xs p-2.5 bg-secondary/5 rounded-lg border border-secondary/10 flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-secondary" />
                                    {s}
                                  </div>
                                ))
                              ) : (
                                <p className="text-xs text-muted-foreground italic">No strengths available.</p>
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
                                {selectedCandidate.skills?.map((s, i) => (
                                  <Badge key={i} variant="secondary" className="bg-muted text-muted-foreground border-none font-medium">
                                    {s}
                                  </Badge>
                                ))}
                                {(!selectedCandidate.skills || selectedCandidate.skills.length === 0) && (
                                  <p className="text-xs text-muted-foreground italic">No skills extracted.</p>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        </div>
                      </TabsContent>

                      <TabsContent value="experience" className="space-y-6">
                        {(selectedCandidate.extractedInfo?.experience || []).length > 0 ? (
                          <div className="relative pl-8 space-y-8 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[2px] before:bg-muted">
                            {selectedCandidate.extractedInfo!.experience.map((exp, i) => (
                              <div key={i} className="relative">
                                <div className="absolute left-[-25px] top-1.5 w-6 h-6 rounded-full bg-white border-2 border-primary flex items-center justify-center">
                                  <div className="w-2 h-2 rounded-full bg-primary" />
                                </div>
                                <div className="bg-white p-5 rounded-xl border border-border/50 shadow-sm hover:shadow-md transition-shadow">
                                  <div className="flex justify-between items-start mb-2">
                                    <h4 className="font-bold text-primary text-lg">{exp.title}</h4>
                                    <Badge variant="outline" className="text-[10px]">{exp.duration}</Badge>
                                  </div>
                                  <p className="text-secondary font-semibold text-sm mb-3">{exp.company}</p>
                                  <p className="text-sm text-muted-foreground leading-relaxed">{exp.description}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground italic text-center py-8">No experience history extracted.</p>
                        )}

                        <div className="pt-4">
                          <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">Education & Training</h4>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {(selectedCandidate.extractedInfo?.education || []).length > 0 ? (
                              selectedCandidate.extractedInfo!.education.map((edu, i) => (
                                <Card key={i} className="shadow-none border-border/50 bg-muted/10">
                                  <CardContent className="p-4">
                                    <p className="font-bold text-primary text-sm">{edu.degree}</p>
                                    <p className="text-xs text-muted-foreground">{edu.institution} • {edu.graduationDate}</p>
                                  </CardContent>
                                </Card>
                              ))
                            ) : (
                              <p className="text-sm text-muted-foreground italic col-span-2">No education history extracted.</p>
                            )}
                          </div>
                        </div>
                      </TabsContent>

                      <TabsContent value="gaps" className="space-y-6">
                        <Card className="border-none shadow-sm bg-destructive/5 overflow-hidden">
                          <div className="bg-destructive p-4 text-white flex items-center gap-2">
                            <AlertCircle className="h-5 w-5" />
                            <span className="font-bold">Missing Qualifications</span>
                          </div>
                          <CardContent className="p-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {!selectedCandidate.matchResults ? (
                                <p className="text-sm italic text-muted-foreground col-span-2">Provide job context for gap analysis.</p>
                              ) : !selectedCandidate.matchResults.missingSkills || selectedCandidate.matchResults.missingSkills.length === 0 ? (
                                <p className="text-sm italic text-muted-foreground col-span-2">Perfect match. No missing skills identified.</p>
                              ) : (
                                selectedCandidate.matchResults.missingSkills.map((s, i) => (
                                  <div key={i} className="flex items-center gap-3 p-3 bg-white rounded-xl border border-destructive/10 shadow-sm">
                                    <div className="w-2 h-2 rounded-full bg-destructive" />
                                    <span className="text-sm font-medium">{s}</span>
                                  </div>
                                ))
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      </TabsContent>

                      <TabsContent value="details" className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                          <div className="space-y-8">
                            {selectedCandidate.jobTitle && (
                              <div className="space-y-4">
                                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Tag className="h-4 w-4" /> Matched For</h4>
                                <Card className="border-border/50 shadow-none bg-white">
                                  <CardContent className="p-4">
                                    <p className="font-semibold text-primary text-base">{selectedCandidate.jobTitle}</p>
                                  </CardContent>
                                </Card>
                              </div>
                            )}

                            <div className="space-y-4">
                              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Details</h4>
                              <div className="space-y-3 bg-white p-4 rounded-xl border border-border/50 shadow-sm">
                                <div className="flex justify-between text-sm items-center">
                                  <span className="text-muted-foreground">Source File</span>
                                  <span className="font-medium text-primary truncate max-w-[200px]" title={selectedCandidate.fileName}>{selectedCandidate.fileName}</span>
                                </div>
                                <div className="flex justify-between text-sm items-center">
                                  <span className="text-muted-foreground">Added</span>
                                  <span className="font-medium text-primary">
                                    {new Date(selectedCandidate.addedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                                  </span>
                                </div>
                                <div className="flex justify-between text-sm items-center">
                                  <span className="text-muted-foreground">Status</span>
                                  <span className="font-medium text-primary">{selectedCandidate.shortlisted ? "Shortlisted" : "In Pool"}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </TabsContent>
                    </Tabs>

                    <div className="pt-8 mt-8 border-t flex items-center justify-between gap-4">
                      <Button
                        variant="outline"
                        className="text-destructive hover:bg-destructive/10 border-transparent hover:border-destructive/30"
                        onClick={() => {
                          onRemove(selectedCandidate.id);
                          setSelectedId(null);
                        }}
                      >
                        <Trash2 className="mr-2 h-4 w-4" /> Remove from Pool
                      </Button>
                      <Button
                        size="lg"
                        className={cn(
                          "px-8 rounded-full",
                          selectedCandidate.shortlisted 
                            ? "bg-amber-500 hover:bg-amber-600 text-white" 
                            : "bg-primary text-primary-foreground"
                        )}
                        onClick={() => onToggleShortlist(selectedCandidate.id)}
                      >
                        {selectedCandidate.shortlisted ? (
                          <><StarOff className="mr-2 h-5 w-5" /> Remove from Shortlist</>
                        ) : (
                          <><Star className="mr-2 h-5 w-5" /> Add to Shortlist</>
                        )}
                      </Button>
                    </div>

                  </div>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
