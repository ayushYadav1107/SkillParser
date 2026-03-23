"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Briefcase,
  Plus,
  Trash2,
  Play,
  Calendar,
  MapPin,
  Building2,
  FileText,
  X,
  Tag,
  Users,
} from "lucide-react";
import { JobPosting } from "@/hooks/use-job-postings";
import { cn } from "@/lib/utils";

interface JobPostingsTabProps {
  postings: JobPosting[];
  onSave: (posting: Omit<JobPosting, "id" | "createdAt" | "candidateCount">) => string;
  onDelete: (id: string) => void;
  onLoadToMatch: (description: string, title?: string) => void;
  readonly?: boolean;
}

export function JobPostingsTab({
  postings,
  onSave,
  onDelete,
  onLoadToMatch,
  readonly = false,
}: JobPostingsTabProps) {
  const [showForm, setShowForm] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formDepartment, setFormDepartment] = useState("");
  const [formLocation, setFormLocation] = useState("");
  const [formType, setFormType] = useState("Full-time");

  const handleSave = () => {
    if (!formTitle.trim() || !formDescription.trim()) return;
    onSave({
      title: formTitle.trim(),
      description: formDescription.trim(),
      keySkills: extractSkillsFromDesc(formDescription),
      department: formDepartment.trim() || undefined,
      location: formLocation.trim() || undefined,
      type: formType || undefined,
    });
    setFormTitle("");
    setFormDescription("");
    setFormDepartment("");
    setFormLocation("");
    setFormType("Full-time");
    setShowForm(false);
  };

  const extractSkillsFromDesc = (desc: string): string[] => {
    const techKeywords = [
      "react", "python", "javascript", "typescript", "java", "c++", "node.js",
      "aws", "azure", "gcp", "docker", "kubernetes", "sql", "mongodb",
      "machine learning", "deep learning", "tensorflow", "pytorch", "nlp",
      "rest api", "graphql", "git", "ci/cd", "agile", "scrum",
      "html", "css", "vue", "angular", "flask", "django", "spring",
    ];
    const lower = desc.toLowerCase();
    return techKeywords.filter((k) => lower.includes(k)).slice(0, 8);
  };

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <header className="h-16 bg-white border-b flex items-center justify-between px-8 shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-primary">Job Postings</h2>
          <Badge variant="outline" className="text-secondary border-secondary">
            {postings.length} Saved
          </Badge>
        </div>
        {!readonly && (
          <Button
            size="sm"
            className="bg-primary text-white"
            onClick={() => setShowForm(!showForm)}
          >
            {showForm ? (
              <>
                <X className="mr-2 h-4 w-4" /> Cancel
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" /> New Posting
              </>
            )}
          </Button>
        )}
      </header>

      <ScrollArea className="flex-1">
        <div className="p-8 max-w-5xl mx-auto space-y-6">
          {/* New Posting Form */}
          {showForm && (
            <Card className="border-primary/20 shadow-lg overflow-hidden animate-in slide-in-from-top-4 duration-300">
              <div className="bg-gradient-to-r from-primary to-primary/80 p-4 text-white">
                <h3 className="font-bold text-lg flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Create New Job Posting
                </h3>
                <p className="text-white/70 text-sm">Save a job description for quick reuse in Active Match.</p>
              </div>
              <CardContent className="p-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="job-title" className="text-sm font-semibold">
                      Job Title *
                    </Label>
                    <Input
                      id="job-title"
                      placeholder="e.g. Senior ML Engineer"
                      value={formTitle}
                      onChange={(e) => setFormTitle(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="job-dept" className="text-sm font-semibold">
                      Department
                    </Label>
                    <Input
                      id="job-dept"
                      placeholder="e.g. Engineering"
                      value={formDepartment}
                      onChange={(e) => setFormDepartment(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="job-location" className="text-sm font-semibold">
                      Location
                    </Label>
                    <Input
                      id="job-location"
                      placeholder="e.g. Remote, NYC"
                      value={formLocation}
                      onChange={(e) => setFormLocation(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="job-type" className="text-sm font-semibold">
                      Employment Type
                    </Label>
                    <select
                      id="job-type"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={formType}
                      onChange={(e) => setFormType(e.target.value)}
                    >
                      <option>Full-time</option>
                      <option>Part-time</option>
                      <option>Contract</option>
                      <option>Internship</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="job-desc" className="text-sm font-semibold">
                    Job Description *
                  </Label>
                  <Textarea
                    id="job-desc"
                    placeholder="Paste or type the full job description here..."
                    className="min-h-[180px] resize-none"
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                  />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <Button variant="outline" onClick={() => setShowForm(false)}>
                    Cancel
                  </Button>
                  <Button
                    className="bg-primary"
                    onClick={handleSave}
                    disabled={!formTitle.trim() || !formDescription.trim()}
                  >
                    Save Posting
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Postings List */}
          {postings.length === 0 && !showForm ? (
            <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
              <div className="bg-muted p-6 rounded-full">
                <Briefcase className="h-12 w-12 text-muted-foreground/50" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-primary mb-2">
                  No job postings saved
                </h3>
                <p className="text-muted-foreground max-w-sm mx-auto text-sm mb-6">
                  {readonly 
                    ? "No job postings have been created by the recruitment team yet." 
                    : "Save your frequently used job descriptions here and load them into Active Match with one click."}
                </p>
                {!readonly && (
                  <Button
                    className="bg-primary text-white"
                    onClick={() => setShowForm(true)}
                  >
                    <Plus className="mr-2 h-4 w-4" /> Create First Posting
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {postings.map((posting) => (
                <Card
                  key={posting.id}
                  className="border-border/50 shadow-sm hover:shadow-md transition-all group"
                >
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-1">
                          <h3 className="font-bold text-primary text-lg">
                            {posting.title}
                          </h3>
                          {posting.type && (
                            <Badge
                              variant="outline"
                              className="text-[10px] shrink-0"
                            >
                              {posting.type}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          {posting.department && (
                            <span className="flex items-center gap-1">
                              <Building2 className="h-3 w-3" />
                              {posting.department}
                            </span>
                          )}
                          {posting.location && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {posting.location}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {new Date(posting.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          className="bg-secondary text-white hover:bg-secondary/90"
                          onClick={() => onLoadToMatch(posting.description, posting.title)}
                        >
                          <Play className="mr-1.5 h-3.5 w-3.5" />
                          Load to Match
                        </Button>
                        {!readonly && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 hover:bg-destructive/10"
                            onClick={() => onDelete(posting.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>

                    <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                      {posting.description}
                    </p>

                    {posting.keySkills.length > 0 && (
                      <div className="flex items-center gap-2 pt-2 border-t border-border/50">
                        <Tag className="h-3 w-3 text-muted-foreground shrink-0" />
                        <div className="flex flex-wrap gap-1.5">
                          {posting.keySkills.map((skill, i) => (
                            <Badge
                              key={i}
                              variant="secondary"
                              className="bg-primary/5 text-primary border-none font-medium text-[10px] py-0"
                            >
                              {skill}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
