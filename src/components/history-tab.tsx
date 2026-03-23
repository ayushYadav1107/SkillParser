"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  History,
  Trash2,
  RotateCcw,
  Calendar,
  Users,
  Briefcase,
  TrendingUp,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { AnalysisHistory } from "@/hooks/use-analysis-history";
import { cn } from "@/lib/utils";

interface HistoryTabProps {
  history: AnalysisHistory[];
  onRestore: (entry: AnalysisHistory) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
}

export function HistoryTab({
  history,
  onRestore,
  onDelete,
  onClearAll,
}: HistoryTabProps) {
  const getAvgScore = (entry: AnalysisHistory): number | null => {
    const scored = entry.candidates.filter(
      (c) => c.matchResults?.matchScore != null
    );
    if (scored.length === 0) return null;
    return Math.round(
      scored.reduce((acc, c) => acc + (c.matchResults?.matchScore ?? 0), 0) /
        scored.length
    );
  };

  const getTimeAgo = (timestamp: number): string => {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
  };

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <header className="h-16 bg-white border-b flex items-center justify-between px-8 shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-primary">
            Analysis History
          </h2>
          <Badge variant="outline" className="text-secondary border-secondary">
            {history.length} Sessions
          </Badge>
        </div>
        {history.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="text-destructive border-destructive/30 hover:bg-destructive/10"
            onClick={onClearAll}
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            Clear All
          </Button>
        )}
      </header>

      <ScrollArea className="flex-1">
        <div className="p-8 max-w-4xl mx-auto space-y-6">
          {history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
              <div className="bg-muted p-6 rounded-full">
                <History className="h-12 w-12 text-muted-foreground/50" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-primary mb-2">
                  No analysis history
                </h3>
                <p className="text-muted-foreground max-w-sm mx-auto text-sm">
                  Your past screening sessions will appear here after you save
                  an analysis from Active Match. You can restore any session
                  with one click.
                </p>
              </div>
            </div>
          ) : (
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-6 top-6 bottom-6 w-[2px] bg-gradient-to-b from-primary via-secondary to-muted hidden md:block" />

              <div className="space-y-4">
                {history.map((entry, index) => {
                  const avgScore = getAvgScore(entry);
                  const completedCount = entry.candidates.filter(
                    (c) => c.status === "completed"
                  ).length;

                  return (
                    <div key={entry.id} className="relative flex gap-4 md:gap-6">
                      {/* Timeline dot */}
                      <div className="hidden md:flex items-start pt-5">
                        <div className="w-12 h-12 rounded-full bg-white border-2 border-primary flex items-center justify-center z-10 shadow-sm shrink-0">
                          <Briefcase className="h-5 w-5 text-primary" />
                        </div>
                      </div>

                      {/* Card */}
                      <Card className="flex-1 border-border/50 shadow-sm hover:shadow-md transition-all group">
                        <CardContent className="p-5">
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="font-bold text-primary">
                                  {entry.jobTitle ||
                                    `Session ${history.length - index}`}
                                </h3>
                                <Badge
                                  variant="outline"
                                  className="text-[10px]"
                                >
                                  {entry.candidates.length} candidate
                                  {entry.candidates.length !== 1 ? "s" : ""}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {getTimeAgo(entry.timestamp)}
                                </span>
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  {new Date(entry.timestamp).toLocaleDateString(
                                    "en-US",
                                    {
                                      month: "short",
                                      day: "numeric",
                                      year: "numeric",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    }
                                  )}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-primary border-primary/30 hover:bg-primary/5"
                                onClick={() => onRestore(entry)}
                              >
                                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                                Restore
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 hover:bg-destructive/10"
                                onClick={() => onDelete(entry.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>

                          {/* Stats Row */}
                          <div className="grid grid-cols-3 gap-3 pt-3 border-t border-border/50">
                            <div className="text-center">
                              <p className="text-lg font-bold text-primary">
                                {completedCount}
                                <span className="text-muted-foreground font-normal text-xs">
                                  /{entry.candidates.length}
                                </span>
                              </p>
                              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                                Analyzed
                              </p>
                            </div>
                            <div className="text-center border-x border-border/50">
                              <p className="text-lg font-bold text-secondary">
                                {avgScore != null ? `${avgScore}%` : "--"}
                              </p>
                              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                                Avg Score
                              </p>
                            </div>
                            <div className="text-center">
                              <p className="text-lg font-bold text-primary">
                                {entry.jobAnalysis.keySkills.length}
                              </p>
                              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                                Key Skills
                              </p>
                            </div>
                          </div>

                          {/* JD Preview */}
                          {entry.jobAnalysis.description && (
                            <p className="text-xs text-muted-foreground line-clamp-2 mt-3 italic bg-muted/30 p-2 rounded-lg">
                              "{entry.jobAnalysis.description.slice(0, 200)}
                              {entry.jobAnalysis.description.length > 200
                                ? "..."
                                : ""}
                              "
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
