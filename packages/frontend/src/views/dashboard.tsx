/** biome-ignore-all lint/correctness/useUniqueElementIds: it's alright */
import { useEffect, useState, useCallback } from "react";
import type { CombinedScorecard, InterviewerArtifact } from "@panelai/shared";
import {
  BriefcaseIcon,
  UsersIcon,
  CalendarIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  ArrowLeftIcon,
  PlusIcon,
  ChartBarIcon,
  StarIcon
} from "@phosphor-icons/react";

const DASHBOARD_RELOAD_STORAGE_KEY = "panelai:dashboard:needs-reload";

// ─── Helpers (early) ─────────────────────────────────────────────────────────────

function prettyKeyEarly(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

async function readTextFromUpload(file: File): Promise<string> {
  const normalize = (raw: string): string =>
    raw
      .replaceAll("\0", "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  const name = file.name.toLowerCase();

  if (name.endsWith(".pdf")) {
    // pdfjs 5 relies on Promise.withResolvers in some runtimes; polyfill if missing.
    if (!("withResolvers" in Promise)) {
      (
        Promise as PromiseConstructor & {
          withResolvers: <T>() => {
            promise: Promise<T>;
            resolve: (value: T | PromiseLike<T>) => void;
            reject: (reason?: unknown) => void;
          };
        }
      ).withResolvers = function withResolvers<T>() {
        let resolve!: (value: T | PromiseLike<T>) => void;
        let reject!: (reason?: unknown) => void;
        const promise = new Promise<T>((res, rej) => {
          resolve = res;
          reject = rej;
        });
        return { promise, resolve, reject };
      };
    }

    const data = new Uint8Array(await file.arrayBuffer());
    const loadPdfJs = async () => {
      try {
        return (await import("pdfjs-dist/legacy/build/pdf.mjs")) as {
          getDocument: (input: {
            data: Uint8Array;
            disableWorker?: boolean;
          }) => { promise: Promise<unknown> };
        };
      } catch {
        try {
          const minifiedPath = "pdfjs-dist/legacy/build/pdf.min.mjs";
          return (await import(/* @vite-ignore */ minifiedPath)) as {
            getDocument: (input: {
              data: Uint8Array;
              disableWorker?: boolean;
            }) => { promise: Promise<unknown> };
          };
        } catch {
          const fallbackPath = "pdfjs-dist/build/pdf.mjs";
          return (await import(/* @vite-ignore */ fallbackPath)) as {
            getDocument: (input: {
              data: Uint8Array;
              disableWorker?: boolean;
            }) => { promise: Promise<unknown> };
          };
        }
      }
    };

    const pdfjs = await loadPdfJs();
    const loadingTask = pdfjs.getDocument({
      data,
      disableWorker: true
    });
    const pdf = (await loadingTask.promise) as {
      numPages: number;
      getPage: (pageNumber: number) => Promise<{
        getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
      }>;
    };

    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item) => item.str ?? "")
        .join(" ")
        .trim();
      if (pageText.length > 0) {
        pages.push(pageText);
      }
    }

    const extracted = normalize(pages.join("\n"));
    if (!extracted) {
      throw new Error("empty-pdf-text");
    }
    return extracted;
  }

  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({
      arrayBuffer: await file.arrayBuffer()
    });
    return normalize(result.value);
  }

  // Legacy .doc files are not reliably parseable in-browser. Best-effort fallback.
  if (name.endsWith(".doc")) {
    const raw = await file.text();
    return normalize(raw);
  }

  const raw = await file.text();
  return normalize(raw);
}

// ─── Agent Meta ──────────────────────────────────────────────────────────────────

const AGENT_META: Record<
  string,
  { displayName: string; role: string; color: string; avatar: string }
> = {
  orchestrator: {
    displayName: "Alex Monroe",
    role: "Interview Moderator",
    color: "#8B5CF6",
    avatar: "https://randomuser.me/api/portraits/men/75.jpg"
  },
  hr: {
    displayName: "Sarah Park",
    role: "HR & Recruiter",
    color: "#EC4899",
    avatar: "https://randomuser.me/api/portraits/women/68.jpg"
  },
  recruiter: {
    displayName: "Sarah Park",
    role: "HR & Recruiter",
    color: "#EC4899",
    avatar: "https://randomuser.me/api/portraits/women/68.jpg"
  },
  technical: {
    displayName: "Dr. Raj Patel",
    role: "Technical Interviewer",
    color: "#3B82F6",
    avatar: "https://randomuser.me/api/portraits/men/11.jpg"
  },
  culture: {
    displayName: "Maya Chen",
    role: "Culture & Values",
    color: "#10B981",
    avatar: "https://randomuser.me/api/portraits/women/44.jpg"
  },
  "domain-expert": {
    displayName: "James Liu",
    role: "Domain Expert",
    color: "#F59E0B",
    avatar: "https://randomuser.me/api/portraits/men/81.jpg"
  },
  behavioral: {
    displayName: "Lisa Torres",
    role: "Behavioral Interviewer",
    color: "#EF4444",
    avatar: "https://randomuser.me/api/portraits/women/53.jpg"
  }
};

function getAgentMeta(agentId: string) {
  const key = agentId
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-agent$/, "");
  return (
    AGENT_META[key] ??
    AGENT_META[agentId] ?? {
      displayName: prettyKeyEarly(agentId),
      role: "Interviewer",
      color: "#64748b",
      avatar: `https://randomuser.me/api/portraits/lego/${Math.abs(agentId.length * 3) % 10}.jpg`
    }
  );
}

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Job {
  id: string;
  title: string;
  department: string;
  location: string;
  level: string;
  employmentType: string;
  remotePolicy: string;
  salaryRange?: { min: number; max: number; currency: string };
  createdAt: string;
}

interface Candidate {
  id: string;
  jobId: string;
  status:
    | "applied"
    | "screening"
    | "shortlisted"
    | "approved"
    | "scheduled"
    | "rejected";
  profile?: {
    name?: string;
    email?: string;
    skills?: string[];
    yearsExperience?: number;
  };
  recruiterArtifact?: {
    weightedScore?: number;
    recommendationBand?: string;
    requiresApproval?: boolean;
    summary?: string;
    strengths?: string[];
    gaps?: string[];
  };
  createdAt: string;
}

interface Interview {
  id: string;
  jobId: string;
  candidateId: string;
  status: "scheduled" | "in-progress" | "deliberation" | "completed";
  phase: string;
  decision?: string;
  createdAt: string;
}

type Scorecard = CombinedScorecard;

// ─── Tabs ──────────────────────────────────────────────────────────────────────

type Tab = "jobs" | "candidates" | "interviews";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(status: string) {
  const styles: Record<string, React.CSSProperties> = {
    applied: { background: "rgba(148,163,184,0.15)", color: "#94a3b8" },
    screening: { background: "rgba(251,191,36,0.15)", color: "#fbbf24" },
    shortlisted: { background: "rgba(59,130,246,0.15)", color: "#60a5fa" },
    approved: { background: "rgba(16,185,129,0.15)", color: "#34d399" },
    scheduled: { background: "rgba(139,92,246,0.15)", color: "#a78bfa" },
    rejected: { background: "rgba(239,68,68,0.15)", color: "#f87171" },
    completed: { background: "rgba(16,185,129,0.15)", color: "#34d399" },
    "in-progress": { background: "rgba(251,191,36,0.15)", color: "#fbbf24" },
    deliberation: { background: "rgba(139,92,246,0.15)", color: "#a78bfa" }
  };
  const style = styles[status] ?? styles.applied;
  return (
    <span
      style={{
        ...style,
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        textTransform: "capitalize" as const,
        letterSpacing: "0.04em"
      }}
    >
      {status}
    </span>
  );
}

function scoreBar(score: number) {
  const color = score >= 80 ? "#34d399" : score >= 60 ? "#fbbf24" : "#f87171";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div
        style={{
          flex: 1,
          height: 4,
          borderRadius: 99,
          background: "rgba(255,255,255,0.06)",
          overflow: "hidden"
        }}
      >
        <div
          style={{
            width: `${score}%`,
            height: "100%",
            borderRadius: 99,
            background: color,
            transition: "width 0.5s ease"
          }}
        />
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color, minWidth: 32 }}>
        {score}
      </span>
    </div>
  );
}

function bandColor(band?: string) {
  if (!band) return "#94a3b8";
  if (band.toLowerCase().includes("strong")) return "#34d399";
  if (band.toLowerCase().includes("potential")) return "#fbbf24";
  return "#f87171";
}

function prettyKey(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function recommendationStyle(value: string): React.CSSProperties {
  const normalized = value.toLowerCase();
  if (normalized.includes("strong") || normalized.includes("advance")) {
    return {
      background: "rgba(16,185,129,0.16)",
      border: "1px solid rgba(16,185,129,0.32)",
      color: "#34d399"
    };
  }

  if (normalized.includes("discuss") || normalized.includes("follow")) {
    return {
      background: "rgba(251,191,36,0.16)",
      border: "1px solid rgba(251,191,36,0.32)",
      color: "#fbbf24"
    };
  }

  return {
    background: "rgba(248,113,113,0.16)",
    border: "1px solid rgba(248,113,113,0.32)",
    color: "#f87171"
  };
}

function artifactEvidenceLines(artifact: InterviewerArtifact): string[] {
  const scoreEvidence = Object.entries(artifact.scores ?? {})
    .map(([criterion, detail]) => {
      const evidence = detail?.evidence?.trim();
      if (!evidence) return null;
      return `${prettyKey(criterion)}: ${evidence}`;
    })
    .filter((value): value is string => Boolean(value));

  const strengths = (artifact.strengths ?? [])
    .map((item) => item.evidence?.trim())
    .filter((value): value is string => Boolean(value))
    .map((value) => `Strength signal: ${value}`);

  const concerns = (artifact.concerns ?? [])
    .map((item) => item.evidence?.trim())
    .filter((value): value is string => Boolean(value))
    .map((value) => `Concern signal: ${value}`);

  return [...scoreEvidence, ...strengths, ...concerns].slice(0, 4);
}

function safeFileSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function overallAgentScore(artifact: InterviewerArtifact): number | null {
  const values = Object.values(artifact.scores ?? {});
  if (values.length === 0) {
    return null;
  }
  const avg = values.reduce((sum, item) => sum + item.score, 0) / values.length;
  return Math.round(avg * 10) / 10;
}

// ─── AgentFeedbackCard ────────────────────────────────────────────────────────

function AgentFeedbackCard({ artifact }: { artifact: InterviewerArtifact }) {
  const [expanded, setExpanded] = useState(false);
  const meta = getAgentMeta(artifact.agentId);
  const avgScore = overallAgentScore(artifact);
  const criteria = Object.entries(artifact.scores ?? {});
  const scoreColor =
    avgScore === null
      ? "#64748b"
      : avgScore >= 4
        ? "#34d399"
        : avgScore >= 3
          ? "#fbbf24"
          : "#f87171";

  return (
    <div
      style={{
        borderRadius: 8,
        background: "rgba(2,6,23,0.55)",
        border: `1px solid ${meta.color}28`,
        overflow: "hidden"
      }}
    >
      {/* Header row */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 14px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left" as const
        }}
      >
        <img
          src={meta.avatar}
          alt={meta.displayName}
          width={40}
          height={40}
          style={{
            borderRadius: "50%",
            border: `2px solid ${meta.color}55`,
            background: "rgba(255,255,255,0.04)",
            flexShrink: 0
          }}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#e7edf8" }}>
            {meta.displayName}
          </div>
          <div style={{ fontSize: 11, color: meta.color, fontWeight: 500 }}>
            {meta.role}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexShrink: 0
          }}
        >
          {avgScore !== null && (
            <div style={{ textAlign: "center" as const }}>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: scoreColor,
                  lineHeight: 1
                }}
              >
                {avgScore.toFixed(1)}
              </div>
              <div style={{ fontSize: 10, color: "#475569" }}>/ 5.0</div>
            </div>
          )}
          <span
            style={{
              ...recommendationStyle(artifact.recommendation),
              borderRadius: 4,
              padding: "3px 8px",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.04em",
              whiteSpace: "nowrap" as const
            }}
          >
            {prettyKey(artifact.recommendation)}
          </span>
          <span
            style={{
              color: "#475569",
              fontSize: 16,
              transform: expanded ? "rotate(180deg)" : "none",
              transition: "transform 0.2s"
            }}
          >
            ▾
          </span>
        </div>
      </button>

      {/* Quick rationale always visible */}
      {artifact.recommendationRationale && (
        <div
          style={{
            padding: "0 14px 10px",
            fontSize: 12,
            color: "#94a3b8",
            lineHeight: 1.5
          }}
        >
          {artifact.recommendationRationale}
        </div>
      )}

      {/* Expanded detail */}
      {expanded && (
        <div
          style={{
            borderTop: "1px solid rgba(148,163,184,0.08)",
            padding: "14px"
          }}
        >
          {/* Criteria scores */}
          {criteria.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#475569",
                  letterSpacing: "0.08em",
                  marginBottom: 8
                }}
              >
                EVALUATION CRITERIA
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {criteria.map(([criterion, detail]) => {
                  const c =
                    detail.score >= 4
                      ? "#34d399"
                      : detail.score >= 3
                        ? "#fbbf24"
                        : "#f87171";
                  return (
                    <div
                      key={criterion}
                      style={{
                        padding: "9px 10px",
                        borderRadius: 6,
                        background: "rgba(15,23,42,0.6)",
                        border: "1px solid rgba(148,163,184,0.07)"
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 4
                        }}
                      >
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: "#e2e8f0"
                          }}
                        >
                          {prettyKey(criterion)}
                        </span>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8
                          }}
                        >
                          <div
                            style={{
                              width: 72,
                              height: 4,
                              borderRadius: 99,
                              background: "rgba(255,255,255,0.07)",
                              overflow: "hidden"
                            }}
                          >
                            <div
                              style={{
                                width: `${(detail.score / 5) * 100}%`,
                                height: "100%",
                                background: c,
                                borderRadius: 99
                              }}
                            />
                          </div>
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              color: c,
                              minWidth: 28
                            }}
                          >
                            {detail.score}/5
                          </span>
                        </div>
                      </div>
                      {detail.evidence && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "#64748b",
                            lineHeight: 1.4
                          }}
                        >
                          <span style={{ color: "#475569", fontWeight: 600 }}>
                            Evidence:{" "}
                          </span>
                          {detail.evidence}
                        </div>
                      )}
                      {detail.justification && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "#4e5f72",
                            lineHeight: 1.4,
                            marginTop: 2
                          }}
                        >
                          <span style={{ color: "#394858", fontWeight: 600 }}>
                            Why:{" "}
                          </span>
                          {detail.justification}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Strengths & Concerns side by side */}
          {((artifact.strengths?.length ?? 0) > 0 ||
            (artifact.concerns?.length ?? 0) > 0) && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
                marginBottom: 14
              }}
            >
              {(artifact.strengths?.length ?? 0) > 0 && (
                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: 6,
                    background: "rgba(52,211,153,0.05)",
                    border: "1px solid rgba(52,211,153,0.15)"
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#34d399",
                      letterSpacing: "0.08em",
                      marginBottom: 6
                    }}
                  >
                    STRENGTHS
                  </div>
                  {artifact.strengths!.map((s, i) => (
                    <div
                      key={i}
                      style={{
                        fontSize: 11,
                        color: "#a7f3d0",
                        lineHeight: 1.5,
                        marginBottom: 4
                      }}
                    >
                      <span style={{ color: "#34d399", marginRight: 4 }}>
                        ✓
                      </span>
                      <strong>{s.point}</strong>
                      {s.evidence && (
                        <span style={{ color: "#6ee7b7", fontSize: 10.5 }}>
                          {" "}
                          — {s.evidence}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {(artifact.concerns?.length ?? 0) > 0 && (
                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: 6,
                    background: "rgba(248,113,113,0.05)",
                    border: "1px solid rgba(248,113,113,0.15)"
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#f87171",
                      letterSpacing: "0.08em",
                      marginBottom: 6
                    }}
                  >
                    CONCERNS
                  </div>
                  {artifact.concerns!.map((c, i) => (
                    <div
                      key={i}
                      style={{
                        fontSize: 11,
                        color: "#fca5a5",
                        lineHeight: 1.5,
                        marginBottom: 4
                      }}
                    >
                      <span style={{ color: "#f87171", marginRight: 4 }}>
                        ⚠
                      </span>
                      <strong>{c.point}</strong>
                      {c.evidence && (
                        <span style={{ color: "#fca5a5", fontSize: 10.5 }}>
                          {" "}
                          — {c.evidence}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Questions Asked */}
          {artifact.questionsAsked && artifact.questionsAsked.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#475569",
                  letterSpacing: "0.08em",
                  marginBottom: 8
                }}
              >
                QUESTIONS ASKED
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {artifact.questionsAsked.map((qa, i) => (
                  <div
                    key={i}
                    style={{
                      padding: "9px 10px",
                      borderRadius: 6,
                      background: "rgba(99,102,241,0.05)",
                      border: "1px solid rgba(99,102,241,0.12)"
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        color: "#a5b4fc",
                        fontWeight: 600,
                        marginBottom: 3
                      }}
                    >
                      Q: {qa.question}
                    </div>
                    {qa.responseSummary && (
                      <div
                        style={{
                          fontSize: 11,
                          color: "#94a3b8",
                          lineHeight: 1.45
                        }}
                      >
                        A: {qa.responseSummary}
                      </div>
                    )}
                    {qa.followUps && qa.followUps.length > 0 && (
                      <div
                        style={{ fontSize: 10, color: "#475569", marginTop: 3 }}
                      >
                        Follow-ups: {qa.followUps.join("; ")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Deliberation notes */}
          {artifact.notes && (
            <div
              style={{
                fontSize: 11,
                color: "#64748b",
                borderTop: "1px solid rgba(148,163,184,0.07)",
                paddingTop: 10
              }}
            >
              <span style={{ fontWeight: 600, color: "#475569" }}>Notes: </span>
              {artifact.notes}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Jobs Tab ─────────────────────────────────────────────────────────────────

function JobsTab({
  jobs,
  onSelect
}: {
  jobs: Job[];
  onSelect: (id: string) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [dept, setDept] = useState("");
  const [location, setLocation] = useState("Remote");
  const [level, setLevel] = useState("mid");
  const [description, setDescription] = useState("");
  const [requiredSkills, setRequiredSkills] = useState("");
  const [saving, setSaving] = useState(false);
  const [ingestingJD, setIngestingJD] = useState(false);
  const [syncingATS, setSyncingATS] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const ingestJobDescription = async (file: File | null) => {
    if (!file) return;
    setIngestingJD(true);
    try {
      const text = await readTextFromUpload(file);
      if (text.length > 0) {
        setDescription(text);
      }
    } catch {
      setSyncMessage(
        "Unable to read JD file. Try .txt/.md/.pdf/.docx or paste manually."
      );
    } finally {
      setIngestingJD(false);
    }
  };

  const createJob = async () => {
    if (!title.trim()) return;

    const requiredSkillList = requiredSkills
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    setSaving(true);
    try {
      await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          department: dept.trim() || "General",
          location: location.trim() || "Remote",
          level: level.trim() || "mid",
          description: description.trim(),
          requiredSkills: requiredSkillList
        })
      });
      window.dispatchEvent(new CustomEvent("dashboard:reload"));
      setTitle("");
      setDept("");
      setLocation("Remote");
      setLevel("mid");
      setDescription("");
      setRequiredSkills("");
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  };

  const importFromGreenhouse = async () => {
    setSyncingATS(true);
    setSyncMessage(null);
    try {
      const response = await fetch("/api/ats/greenhouse/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });

      const payload = (await response.json().catch(() => null)) as {
        jobsCreated?: number;
        candidatesCreated?: number;
        jobsUpdated?: number;
        candidatesUpdated?: number;
        error?: string;
      } | null;

      if (!response.ok) {
        setSyncMessage(payload?.error ?? "Greenhouse sync failed.");
        return;
      }

      setSyncMessage(
        `ATS import complete: ${payload?.jobsCreated ?? 0} jobs + ${payload?.candidatesCreated ?? 0} candidates created.`
      );
      window.dispatchEvent(new CustomEvent("dashboard:reload"));
    } catch {
      setSyncMessage("Greenhouse sync failed.");
    } finally {
      setSyncingATS(false);
    }
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20
        }}
      >
        <h2
          style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#e7edf8" }}
        >
          Open Roles
        </h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            onClick={importFromGreenhouse}
            disabled={syncingATS}
            style={{
              ...btnGhost,
              display: "flex",
              alignItems: "center",
              gap: 6
            }}
          >
            {syncingATS ? "Syncing ATS..." : "Import From Greenhouse"}
          </button>
          <button
            type="button"
            onClick={() => setShowForm(!showForm)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              borderRadius: 6,
              background: "rgba(99,102,241,0.15)",
              border: "1px solid rgba(99,102,241,0.35)",
              color: "#a5b4fc",
              fontSize: 13,
              cursor: "pointer"
            }}
          >
            <PlusIcon size={14} /> New Job
          </button>
        </div>
      </div>

      {syncMessage && (
        <div
          style={{
            marginBottom: 14,
            padding: "8px 12px",
            borderRadius: 6,
            fontSize: 12,
            color: "#cbd5e1",
            background: "rgba(15,23,42,0.7)",
            border: "1px solid rgba(148,163,184,0.16)"
          }}
        >
          {syncMessage}
        </div>
      )}

      {showForm && (
        <div
          style={{
            marginBottom: 20,
            padding: 16,
            borderRadius: 8,
            background: "rgba(2,6,23,0.6)",
            border: "1px solid rgba(148,163,184,0.12)"
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 12
            }}
          >
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Job title (e.g. Senior React Engineer)"
              style={inputStyle}
            />
            <input
              value={dept}
              onChange={(e) => setDept(e.target.value)}
              placeholder="Department (e.g. Engineering)"
              style={inputStyle}
            />
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Location (e.g. Remote / SF)"
              style={inputStyle}
            />
            <input
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              placeholder="Level (entry/mid/senior/lead/principal)"
              style={inputStyle}
            />
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            placeholder="Paste job description here..."
            style={{ ...inputStyle, resize: "vertical", marginBottom: 10 }}
          />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 12
            }}
          >
            <input
              value={requiredSkills}
              onChange={(e) => setRequiredSkills(e.target.value)}
              placeholder="Required skills (comma-separated)"
              style={inputStyle}
            />
            <label
              style={{
                ...inputStyle,
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: "pointer",
                color: "#94a3b8"
              }}
            >
              <span>
                {ingestingJD
                  ? "Reading JD..."
                  : "Upload JD (.txt/.md/.pdf/.docx/.doc)"}
              </span>
              <input
                type="file"
                accept=".txt,.md,.pdf,.docx,.doc"
                onChange={(event) => {
                  void ingestJobDescription(
                    event.currentTarget.files?.[0] ?? null
                  );
                }}
                style={{ display: "none" }}
              />
            </label>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={createJob}
              disabled={saving}
              style={btnPrimary}
            >
              {saving ? "Creating..." : "Create Job"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              style={btnGhost}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {jobs.length === 0 ? (
        <EmptyState
          icon={<BriefcaseIcon size={32} />}
          message="No jobs yet. Create one to get started."
        />
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {jobs.map((job) => (
            <button
              type="button"
              key={job.id}
              onClick={() => onSelect(job.id)}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "14px 18px",
                borderRadius: 8,
                cursor: "pointer",
                background: "rgba(2,6,23,0.5)",
                border: "1px solid rgba(148,163,184,0.1)",
                transition: "border-color 0.15s"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "rgba(99,102,241,0.4)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "rgba(148,163,184,0.1)";
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start"
                }}
              >
                <div>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 15,
                      color: "#e7edf8",
                      marginBottom: 4
                    }}
                  >
                    {job.title}
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>
                    {job.department} · {job.location} · {job.level} ·{" "}
                    {job.remotePolicy}
                  </div>
                </div>
                <span style={{ fontSize: 11, color: "#475569" }}>
                  {new Date(job.createdAt).toLocaleDateString()}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Candidates Tab ───────────────────────────────────────────────────────────

function CandidatesTab({
  candidates,
  jobs,
  selectedJobId
}: {
  candidates: Candidate[];
  jobs: Job[];
  selectedJobId: string | null;
}) {
  const [approving, setApproving] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [uploadingCandidate, setUploadingCandidate] = useState(false);
  const [uploadJobId, setUploadJobId] = useState(
    selectedJobId ?? jobs[0]?.id ?? ""
  );
  const [candidateNameInput, setCandidateNameInput] = useState("");
  const [candidateEmailInput, setCandidateEmailInput] = useState("");
  const [candidateYearsInput, setCandidateYearsInput] = useState("");
  const [candidateSkillsInput, setCandidateSkillsInput] = useState("");
  const [resumeTextInput, setResumeTextInput] = useState("");
  const [ingestingResume, setIngestingResume] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedJobId) {
      setUploadJobId(selectedJobId);
      return;
    }

    if (!uploadJobId && jobs.length > 0) {
      setUploadJobId(jobs[0].id);
    }
  }, [jobs, selectedJobId, uploadJobId]);

  const jobTitle = (id: string) => jobs.find((j) => j.id === id)?.title ?? id;

  const ingestResume = async (file: File | null) => {
    if (!file) return;
    setIngestingResume(true);
    setUploadError(null);
    try {
      const text = await readTextFromUpload(file);
      if (!text) {
        setUploadError("Uploaded resume was empty.");
        return;
      }
      setResumeTextInput(text);
    } catch (error) {
      const reason =
        error instanceof Error && error.message
          ? ` (${error.message.slice(0, 140)})`
          : "";
      setUploadError(
        `Unable to read resume file. Try .txt/.md/.pdf/.docx or paste text manually (scanned PDFs may need OCR).${reason}`
      );
    } finally {
      setIngestingResume(false);
    }
  };

  const submitCandidate = async () => {
    if (!uploadJobId) {
      setUploadError("Select a job before uploading a candidate.");
      return;
    }

    if (!candidateNameInput.trim() && !resumeTextInput.trim()) {
      setUploadError("Provide candidate name or resume text.");
      return;
    }

    const years = Number(candidateYearsInput);
    const skills = candidateSkillsInput
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    setUploadingCandidate(true);
    setUploadError(null);
    try {
      const response = await fetch(`/api/jobs/${uploadJobId}/candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resumeText: resumeTextInput.trim() || undefined,
          profile: {
            name: candidateNameInput.trim() || undefined,
            email: candidateEmailInput.trim() || undefined,
            yearsExperience: Number.isFinite(years) ? years : undefined,
            skills
          }
        })
      });

      if (!response.ok) {
        setUploadError("Candidate upload failed.");
        return;
      }

      setCandidateNameInput("");
      setCandidateEmailInput("");
      setCandidateYearsInput("");
      setCandidateSkillsInput("");
      setResumeTextInput("");
      window.dispatchEvent(new CustomEvent("dashboard:reload"));
    } catch {
      setUploadError("Candidate upload failed.");
    } finally {
      setUploadingCandidate(false);
    }
  };

  const approve = async (cid: string, jobId: string) => {
    setApproving(cid);
    try {
      await fetch(`/api/jobs/${jobId}/candidates/${cid}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note || "Approved by hiring manager" })
      });
      window.dispatchEvent(new CustomEvent("dashboard:reload"));
      setNote("");
    } finally {
      setApproving(null);
    }
  };

  const reject = async (cid: string, jobId: string) => {
    setRejecting(cid);
    try {
      await fetch(`/api/jobs/${jobId}/candidates/${cid}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note || "Not a fit at this time" })
      });
      window.dispatchEvent(new CustomEvent("dashboard:reload"));
      setNote("");
    } finally {
      setRejecting(null);
    }
  };

  const actionable = candidates.filter(
    (c) => c.status === "shortlisted" || c.status === "screening"
  );
  const others = candidates.filter((c) => !actionable.includes(c));

  return (
    <div>
      <h2
        style={{
          margin: "0 0 20px",
          fontSize: 18,
          fontWeight: 700,
          color: "#e7edf8"
        }}
      >
        Candidates
      </h2>

      <div
        style={{
          marginBottom: 22,
          padding: "14px 16px",
          borderRadius: 8,
          background: "rgba(2,6,23,0.6)",
          border: "1px solid rgba(148,163,184,0.12)"
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#64748b",
            letterSpacing: "0.08em",
            marginBottom: 10
          }}
        >
          ADD CANDIDATE (MANUAL RESUME/JD FLOW)
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
            marginBottom: 10
          }}
        >
          <select
            value={uploadJobId}
            onChange={(event) => setUploadJobId(event.target.value)}
            style={inputStyle}
          >
            <option value="">Select Job</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.title}
              </option>
            ))}
          </select>
          <input
            value={candidateNameInput}
            onChange={(event) => setCandidateNameInput(event.target.value)}
            placeholder="Candidate name"
            style={inputStyle}
          />
          <input
            value={candidateEmailInput}
            onChange={(event) => setCandidateEmailInput(event.target.value)}
            placeholder="Candidate email"
            style={inputStyle}
          />
          <input
            value={candidateYearsInput}
            onChange={(event) => setCandidateYearsInput(event.target.value)}
            placeholder="Years of experience"
            style={inputStyle}
          />
          <input
            value={candidateSkillsInput}
            onChange={(event) => setCandidateSkillsInput(event.target.value)}
            placeholder="Skills (comma-separated)"
            style={{ ...inputStyle, gridColumn: "1 / -1" }}
          />
        </div>

        <textarea
          value={resumeTextInput}
          onChange={(event) => setResumeTextInput(event.target.value)}
          rows={5}
          placeholder="Paste resume text (or upload a file below)..."
          style={{ ...inputStyle, resize: "vertical", marginBottom: 10 }}
        />

        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginBottom: uploadError ? 8 : 0
          }}
        >
          <label
            style={{
              ...btnGhost,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              cursor: "pointer"
            }}
          >
            {ingestingResume
              ? "Reading resume..."
              : "Upload Resume (.txt/.md/.pdf/.docx/.doc)"}
            <input
              type="file"
              accept=".txt,.md,.pdf,.docx,.doc"
              onChange={(event) => {
                void ingestResume(event.currentTarget.files?.[0] ?? null);
              }}
              style={{ display: "none" }}
            />
          </label>
          <button
            type="button"
            onClick={submitCandidate}
            disabled={uploadingCandidate}
            style={btnPrimary}
          >
            {uploadingCandidate ? "Uploading..." : "Upload Candidate"}
          </button>
        </div>

        {uploadError && (
          <div style={{ fontSize: 12, color: "#fca5a5" }}>{uploadError}</div>
        )}
      </div>

      {actionable.length > 0 && (
        <>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#64748b",
              letterSpacing: "0.08em",
              marginBottom: 10
            }}
          >
            AWAITING REVIEW
          </div>
          <div style={{ display: "grid", gap: 12, marginBottom: 24 }}>
            {actionable.map((c) => (
              <div
                key={c.id}
                style={{
                  padding: "16px 18px",
                  borderRadius: 8,
                  background: "rgba(2,6,23,0.5)",
                  border: "1px solid rgba(251,191,36,0.2)"
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 10
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: 15,
                        color: "#e7edf8"
                      }}
                    >
                      {c.profile?.name ?? "Unknown Candidate"}
                    </div>
                    <div
                      style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}
                    >
                      {jobTitle(c.jobId)} · {c.profile?.yearsExperience ?? "?"}{" "}
                      yrs exp
                    </div>
                    {c.profile?.skills && (
                      <div
                        style={{
                          display: "flex",
                          gap: 4,
                          marginTop: 6,
                          flexWrap: "wrap" as const
                        }}
                      >
                        {c.profile.skills.slice(0, 5).map((s) => (
                          <span
                            key={s}
                            style={{
                              padding: "2px 7px",
                              borderRadius: 4,
                              fontSize: 11,
                              background: "rgba(99,102,241,0.12)",
                              color: "#a5b4fc"
                            }}
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: "right" as const }}>
                    {statusBadge(c.status)}
                    {c.recruiterArtifact?.weightedScore !== undefined && (
                      <div style={{ marginTop: 8, minWidth: 120 }}>
                        {scoreBar(c.recruiterArtifact.weightedScore)}
                        <div
                          style={{
                            fontSize: 11,
                            color: bandColor(
                              c.recruiterArtifact.recommendationBand
                            ),
                            marginTop: 3,
                            textAlign: "right" as const
                          }}
                        >
                          {c.recruiterArtifact.recommendationBand}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {c.recruiterArtifact?.summary && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "#94a3b8",
                      marginBottom: 10,
                      lineHeight: 1.5
                    }}
                  >
                    {c.recruiterArtifact.summary}
                  </div>
                )}

                {((c.recruiterArtifact?.strengths?.length ?? 0) > 0 ||
                  (c.recruiterArtifact?.gaps?.length ?? 0) > 0) && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 8,
                      marginBottom: 10
                    }}
                  >
                    {(c.recruiterArtifact?.strengths?.length ?? 0) > 0 && (
                      <div
                        style={{
                          padding: "8px 10px",
                          borderRadius: 5,
                          background: "rgba(52,211,153,0.05)",
                          border: "1px solid rgba(52,211,153,0.14)"
                        }}
                      >
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: "#34d399",
                            letterSpacing: "0.07em",
                            marginBottom: 5
                          }}
                        >
                          STRENGTHS
                        </div>
                        {c.recruiterArtifact!.strengths!.map((s, i) => (
                          <div
                            key={i}
                            style={{
                              fontSize: 11,
                              color: "#a7f3d0",
                              marginBottom: 2
                            }}
                          >
                            ✓ {s}
                          </div>
                        ))}
                      </div>
                    )}
                    {(c.recruiterArtifact?.gaps?.length ?? 0) > 0 && (
                      <div
                        style={{
                          padding: "8px 10px",
                          borderRadius: 5,
                          background: "rgba(248,113,113,0.05)",
                          border: "1px solid rgba(248,113,113,0.14)"
                        }}
                      >
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: "#f87171",
                            letterSpacing: "0.07em",
                            marginBottom: 5
                          }}
                        >
                          GAPS
                        </div>
                        {c.recruiterArtifact!.gaps!.map((g, i) => (
                          <div
                            key={i}
                            style={{
                              fontSize: 11,
                              color: "#fca5a5",
                              marginBottom: 2
                            }}
                          >
                            ⚠ {g}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Optional note..."
                    style={{
                      ...inputStyle,
                      flex: 1,
                      padding: "5px 10px",
                      fontSize: 12
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => approve(c.id, c.jobId)}
                    disabled={approving === c.id}
                    style={{ ...btnApprove, padding: "6px 14px" }}
                  >
                    <CheckCircleIcon size={14} />
                    {approving === c.id ? "..." : "Approve"}
                  </button>
                  <button
                    type="button"
                    onClick={() => reject(c.id, c.jobId)}
                    disabled={rejecting === c.id}
                    style={{ ...btnReject, padding: "6px 14px" }}
                  >
                    <XCircleIcon size={14} />
                    {rejecting === c.id ? "..." : "Reject"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {others.length > 0 && (
        <>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#64748b",
              letterSpacing: "0.08em",
              marginBottom: 10
            }}
          >
            ALL CANDIDATES
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {others.map((c) => (
              <div
                key={c.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px 16px",
                  borderRadius: 8,
                  background: "rgba(2,6,23,0.4)",
                  border: "1px solid rgba(148,163,184,0.08)"
                }}
              >
                <div>
                  <div
                    style={{ fontWeight: 500, fontSize: 14, color: "#cbd5e1" }}
                  >
                    {c.profile?.name ?? "Unknown"}
                  </div>
                  <div style={{ fontSize: 12, color: "#475569" }}>
                    {jobTitle(c.jobId)}
                  </div>
                </div>
                {statusBadge(c.status)}
              </div>
            ))}
          </div>
        </>
      )}

      {candidates.length === 0 && (
        <EmptyState
          icon={<UsersIcon size={32} />}
          message="No candidates yet. They'll appear here as they apply."
        />
      )}
    </div>
  );
}

// ─── Agent Office (live activity stream) ──────────────────────────────────────

interface ActivityEvent {
  id: string;
  timestamp: string;
  agentId: string;
  agentRole?: string;
  type: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

interface PanelTranscriptTurn {
  role: "candidate" | "panel";
  speaker?: string;
  text: string;
}

function AgentOfficePanel({ interviewId }: { interviewId: string }) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let lastTimestamp = "";

    const poll = async () => {
      try {
        const qs = lastTimestamp
          ? `?since=${encodeURIComponent(lastTimestamp)}`
          : "";
        const response = await fetch(
          `/api/interviews/${interviewId}/activity${qs}`
        );
        if (!response.ok) {
          if (!cancelled) setError(`HTTP ${response.status}`);
          return;
        }
        const next = (await response.json()) as ActivityEvent[];
        if (cancelled) return;
        if (next.length > 0) {
          lastTimestamp = next[next.length - 1].timestamp;
          setEvents((prev) => [...prev, ...next].slice(-200));
        }
        setError(null);
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    };

    setEvents([]);
    poll();
    const interval = setInterval(poll, 1800);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [interviewId]);

  const typeLabel: Record<string, string> = {
    "turn-started": "thinking",
    "turn-produced": "spoke",
    "turn-failed": "turn failed",
    "delegation-started": "delegated",
    "delegation-completed": "delegation done",
    "delegation-failed": "delegation failed",
    "scoring-started": "scoring",
    "score-produced": "scored",
    "deliberation-started": "deliberating",
    "deliberation-completed": "deliberation done",
    "memory-write": "wrote memory",
    "route-selected": "routed",
    "bias-flag": "bias flag"
  };

  return (
    <div
      style={{
        padding: "14px 16px",
        borderRadius: 10,
        background: "rgba(2,6,23,0.6)",
        border: "1px solid rgba(148,163,184,0.12)",
        marginTop: 16
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 14, color: "#e7edf8" }}>
          Agent Office · Live
        </div>
        <div style={{ fontSize: 11, color: "#64748b" }}>
          {events.length} event{events.length === 1 ? "" : "s"}
        </div>
      </div>

      {error && (
        <div style={{ fontSize: 11, color: "#f87171", marginBottom: 8 }}>
          {error}
        </div>
      )}

      {events.length === 0 ? (
        <div style={{ fontSize: 12, color: "#64748b", padding: "12px 0" }}>
          Waiting for the panel to start working…
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            maxHeight: 520,
            overflowY: "auto"
          }}
        >
          {events
            .slice()
            .reverse()
            .map((event) => {
              const meta = getAgentMeta(event.agentRole ?? event.agentId);
              return (
                <div
                  key={event.id}
                  style={{
                    display: "flex",
                    gap: 10,
                    padding: "10px 12px",
                    borderRadius: 8,
                    background: "rgba(15,23,42,0.6)",
                    border: `1px solid ${meta.color}22`
                  }}
                >
                  <img
                    src={meta.avatar}
                    alt={meta.displayName}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      border: `2px solid ${meta.color}`,
                      flexShrink: 0
                    }}
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "baseline",
                        marginBottom: 2
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: 12,
                          color: "#e7edf8"
                        }}
                      >
                        {meta.displayName}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          color: meta.color,
                          textTransform: "uppercase",
                          letterSpacing: 0.4
                        }}
                      >
                        {typeLabel[event.type] ?? event.type}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          color: "#64748b",
                          marginLeft: "auto"
                        }}
                      >
                        {new Date(event.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "#cbd5e1",
                        lineHeight: 1.4
                      }}
                    >
                      {event.summary}
                    </div>
                    {event.metadata &&
                      Object.keys(event.metadata).length > 0 && (
                        <div
                          style={{
                            marginTop: 6,
                            display: "grid",
                            gap: 4
                          }}
                        >
                          {Object.entries(event.metadata)
                            .slice(0, 4)
                            .map(([key, value]) => (
                              <div
                                key={key}
                                style={{
                                  fontSize: 10.5,
                                  color: "#94a3b8",
                                  lineHeight: 1.35
                                }}
                              >
                                <span
                                  style={{ color: "#64748b", fontWeight: 600 }}
                                >
                                  {prettyKey(key)}:
                                </span>{" "}
                                {typeof value === "string"
                                  ? value
                                  : JSON.stringify(value)}
                              </div>
                            ))}
                        </div>
                      )}
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

// ─── Interviews Tab ────────────────────────────────────────────────────────────

function InterviewsTab({
  interviews,
  candidates,
  jobs
}: {
  interviews: Interview[];
  candidates: Candidate[];
  jobs: Job[];
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [decision, setDecision] = useState<"hire" | "reject" | "follow-up">(
    "hire"
  );
  const [decisionNote, setDecisionNote] = useState("");
  const [exportingPdf, setExportingPdf] = useState(false);
  const [transcript, setTranscript] = useState<PanelTranscriptTurn[]>([]);
  const [transcriptLoading, setTranscriptLoading] = useState(false);

  const candidateName = (id: string) =>
    candidates.find((c) => c.id === id)?.profile?.name ?? id;
  const jobTitle = (id: string) => jobs.find((j) => j.id === id)?.title ?? id;

  const loadScorecard = useCallback(
    async (interviewId: string) => {
      try {
        const fetchScorecard = async (): Promise<Scorecard | null> => {
          const response = await fetch(
            `/api/interviews/${interviewId}/scorecard`
          );
          if (!response.ok) {
            return null;
          }
          return (await response.json()) as Scorecard;
        };

        let nextScorecard = await fetchScorecard();

        const hasArtifacts = (nextScorecard?.agentArtifacts?.length ?? 0) > 0;
        if (!hasArtifacts) {
          const interview = interviews.find((i) => i.id === interviewId);

          if (interview?.candidateId) {
            const rerunResponse = await fetch("/api/interview/run-panel", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                interviewId,
                candidateId: interview.candidateId
              })
            });

            if (rerunResponse.ok) {
              nextScorecard = (await fetchScorecard()) ?? nextScorecard;
              window.dispatchEvent(new CustomEvent("dashboard:reload"));
            }
          }
        }

        if (nextScorecard) {
          setScorecard(nextScorecard);
        }
      } catch (_) {}
    },
    [interviews]
  );

  const loadTranscript = useCallback(async (interviewId: string) => {
    setTranscriptLoading(true);
    try {
      const response = await fetch(`/api/interviews/${interviewId}/transcript`);
      if (!response.ok) {
        setTranscript([]);
        return;
      }
      const payload = (await response.json()) as PanelTranscriptTurn[];
      setTranscript(Array.isArray(payload) ? payload : []);
    } catch {
      setTranscript([]);
    } finally {
      setTranscriptLoading(false);
    }
  }, []);

  const selectInterview = (id: string) => {
    setSelected(id);
    setScorecard(null);
    setTranscript([]);
    loadScorecard(id);
    void loadTranscript(id);
  };

  const submitDecision = async () => {
    if (!selected) return;
    setDeciding(true);
    try {
      const response = await fetch(`/api/interviews/${selected}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          notes: decisionNote,
          decidedBy: "Hiring Manager"
        })
      });

      if (response.ok) {
        window.dispatchEvent(new CustomEvent("dashboard:reload"));
        loadScorecard(selected);
      }

      setDecisionNote("");
    } finally {
      setDeciding(false);
    }
  };

  const selectedInterview = interviews.find((i) => i.id === selected);
  const canTakeDecision =
    Boolean(scorecard) &&
    !selectedInterview?.decision &&
    (selectedInterview?.status === "deliberation" ||
      scorecard?.status === "ready-for-decision");

  const buildReviewPacket = () => {
    if (!selectedInterview || !scorecard) {
      return null;
    }

    return {
      generatedAt: new Date().toISOString(),
      interview: {
        id: selectedInterview.id,
        status: selectedInterview.status,
        phase: selectedInterview.phase,
        jobTitle: jobTitle(selectedInterview.jobId),
        candidateName: candidateName(selectedInterview.candidateId)
      },
      recommendation: {
        synthesizedRecommendation: scorecard.synthesizedRecommendation,
        synthesisRationale: scorecard.synthesisRationale,
        overallScores: scorecard.overallScores
      },
      humanDecision: scorecard.humanDecision ?? null,
      agentEvidence: (scorecard.agentArtifacts ?? []).map((artifact) => ({
        agentId: artifact.agentId,
        recommendation: artifact.recommendation,
        recommendationRationale: artifact.recommendationRationale,
        evidenceSnapshot: artifactEvidenceLines(artifact),
        strengths: artifact.strengths,
        concerns: artifact.concerns
      })),
      transcript
    };
  };

  const downloadReviewPacketJson = () => {
    const packet = buildReviewPacket();
    if (!packet) return;

    const content = JSON.stringify(packet, null, 2);
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const candidatePart = safeFileSegment(
      packet.interview.candidateName || "candidate"
    );
    anchor.href = url;
    anchor.download = `review-packet-${candidatePart}-${packet.interview.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const downloadReviewPacketPdf = async () => {
    const packet = buildReviewPacket();
    if (!packet) return;

    setExportingPdf(true);
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "pt", format: "letter" });
      const margin = 40;
      const maxWidth = doc.internal.pageSize.getWidth() - margin * 2;
      const pageBottom = doc.internal.pageSize.getHeight() - margin;
      let y = margin;

      const ensureSpace = (lineCount = 1, lineHeight = 14) => {
        if (y + lineCount * lineHeight > pageBottom) {
          doc.addPage();
          y = margin;
        }
      };

      const writeHeading = (text: string, size = 13) => {
        ensureSpace(2, 20);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(size);
        doc.text(text, margin, y);
        y += size + 8;
      };

      const writeBody = (text: string, size = 10) => {
        const lines = doc.splitTextToSize(text, maxWidth) as string[];
        doc.setFont("helvetica", "normal");
        doc.setFontSize(size);
        for (const line of lines) {
          ensureSpace(1, size + 4);
          doc.text(line, margin, y);
          y += size + 4;
        }
      };

      writeHeading("PanelAI Review Packet", 16);
      writeBody(`Generated: ${new Date(packet.generatedAt).toLocaleString()}`);
      writeBody(`Interview ID: ${packet.interview.id}`);
      writeBody(`Candidate: ${packet.interview.candidateName}`);
      writeBody(`Role: ${packet.interview.jobTitle}`);
      y += 6;

      writeHeading("Recommendation Summary");
      writeBody(
        `Synthesized recommendation: ${prettyKey(packet.recommendation.synthesizedRecommendation)}`
      );
      writeBody(
        `Rationale: ${packet.recommendation.synthesisRationale || "No synthesis rationale provided."}`
      );
      if (packet.humanDecision) {
        writeBody(
          `Human decision: ${packet.humanDecision.decision} by ${packet.humanDecision.decidedBy} at ${new Date(packet.humanDecision.decidedAt).toLocaleString()}`
        );
        if (packet.humanDecision.notes) {
          writeBody(`Decision notes: ${packet.humanDecision.notes}`);
        }
      }
      y += 6;

      writeHeading("Agent Evidence Snapshot");
      for (const evidence of packet.agentEvidence) {
        writeBody(
          `${prettyKey(evidence.agentId)} - ${prettyKey(evidence.recommendation)}`
        );
        writeBody(
          `Reasoning: ${evidence.recommendationRationale || "No rationale provided."}`
        );
        if (evidence.evidenceSnapshot.length > 0) {
          for (const line of evidence.evidenceSnapshot) {
            writeBody(`- ${line}`);
          }
        } else {
          writeBody("- No explicit evidence lines provided.");
        }
        y += 4;
      }

      writeHeading("Interview Transcript");
      if (packet.transcript.length === 0) {
        writeBody("No transcript captured.");
      } else {
        for (const turn of packet.transcript) {
          const speaker =
            turn.role === "candidate" ? "Candidate" : turn.speaker || "Panel";
          writeBody(`${speaker}: ${turn.text}`);
          y += 2;
        }
      }

      const candidatePart = safeFileSegment(
        packet.interview.candidateName || "candidate"
      );
      doc.save(`review-packet-${candidatePart}-${packet.interview.id}.pdf`);
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: selected
          ? "minmax(300px, 0.8fr) minmax(620px, 1.4fr)"
          : "1fr",
        gap: 20,
        alignItems: "start"
      }}
    >
      <div>
        <h2
          style={{
            margin: "0 0 20px",
            fontSize: 18,
            fontWeight: 700,
            color: "#e7edf8"
          }}
        >
          Interviews
        </h2>
        {interviews.length === 0 ? (
          <EmptyState
            icon={<CalendarIcon size={32} />}
            message="No interviews scheduled yet."
          />
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {interviews.map((iv) => (
              <button
                type="button"
                key={iv.id}
                onClick={() => selectInterview(iv.id)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "14px 16px",
                  borderRadius: 8,
                  cursor: "pointer",
                  background:
                    selected === iv.id
                      ? "rgba(99,102,241,0.1)"
                      : "rgba(2,6,23,0.5)",
                  border: `1px solid ${selected === iv.id ? "rgba(99,102,241,0.4)" : "rgba(148,163,184,0.1)"}`,
                  transition: "all 0.15s"
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start"
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: 14,
                        color: "#e7edf8",
                        marginBottom: 3
                      }}
                    >
                      {candidateName(iv.candidateId)}
                    </div>
                    <div style={{ fontSize: 12, color: "#64748b" }}>
                      {jobTitle(iv.jobId)} · {iv.phase}
                    </div>
                  </div>
                  {statusBadge(iv.status)}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && selectedInterview && (
        <div
          style={{
            padding: "22px 24px",
            borderRadius: 10,
            background: "rgba(2,6,23,0.6)",
            border: "1px solid rgba(148,163,184,0.12)"
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 16
            }}
          >
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#e7edf8" }}>
                {candidateName(selectedInterview.candidateId)}
              </div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                {jobTitle(selectedInterview.jobId)}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {scorecard && (
                <>
                  <button
                    type="button"
                    onClick={downloadReviewPacketJson}
                    style={btnGhost}
                  >
                    Download JSON
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void downloadReviewPacketPdf();
                    }}
                    disabled={exportingPdf}
                    style={btnGhost}
                  >
                    {exportingPdf ? "Building PDF..." : "Download PDF"}
                  </button>
                </>
              )}
              {statusBadge(
                scorecard &&
                  selectedInterview.status === "scheduled" &&
                  scorecard.status !== "decided"
                  ? "deliberation"
                  : selectedInterview.status
              )}
            </div>
          </div>

          <AgentOfficePanel interviewId={selectedInterview.id} />

          {scorecard ? (
            <>
              {scorecard.synthesizedRecommendation && (
                <div
                  style={{
                    padding: "10px 14px",
                    borderRadius: 6,
                    marginBottom: 16,
                    background: "rgba(99,102,241,0.1)",
                    border: "1px solid rgba(99,102,241,0.2)",
                    fontSize: 13,
                    color: "#c7d2fe",
                    lineHeight: 1.5
                  }}
                >
                  <div
                    style={{
                      fontWeight: 600,
                      marginBottom: 4,
                      color: "#a5b4fc"
                    }}
                  >
                    AI Recommendation
                  </div>
                  <div
                    style={{
                      marginBottom: scorecard.synthesisRationale ? 8 : 0
                    }}
                  >
                    {prettyKey(scorecard.synthesizedRecommendation)}
                  </div>
                  {scorecard.synthesisRationale && (
                    <div style={{ fontSize: 12, color: "#cbd5e1" }}>
                      {scorecard.synthesisRationale}
                    </div>
                  )}
                </div>
              )}

              {Object.keys(scorecard.overallScores ?? {}).length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#64748b",
                      letterSpacing: "0.08em",
                      marginBottom: 10
                    }}
                  >
                    OVERALL SCORE DIMENSIONS
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(160px, 1fr))",
                      gap: 8
                    }}
                  >
                    {Object.entries(scorecard.overallScores).map(
                      ([metric, value]) => (
                        <div
                          key={metric}
                          style={{
                            padding: "8px 10px",
                            borderRadius: 6,
                            background: "rgba(255,255,255,0.03)",
                            border: "1px solid rgba(148,163,184,0.08)"
                          }}
                        >
                          <div
                            style={{
                              fontSize: 11,
                              color: "#64748b",
                              marginBottom: 4
                            }}
                          >
                            {prettyKey(metric)}
                          </div>
                          <div
                            style={{
                              fontSize: 14,
                              fontWeight: 700,
                              color: "#e2e8f0"
                            }}
                          >
                            {value.toFixed(1)} / 5
                          </div>
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}

              {scorecard.agentArtifacts &&
                scorecard.agentArtifacts.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#64748b",
                        letterSpacing: "0.08em",
                        marginBottom: 10
                      }}
                    >
                      VERDICT EVIDENCE SNAPSHOT
                    </div>
                    <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
                      {scorecard.agentArtifacts.map((artifact, idx) => {
                        const meta = getAgentMeta(artifact.agentId);
                        const evidenceLines = artifactEvidenceLines(artifact);
                        return (
                          <div
                            key={`${artifact.agentId}-${idx}-evidence`}
                            style={{
                              borderRadius: 8,
                              padding: "10px 12px",
                              background: "rgba(15,23,42,0.65)",
                              border: `1px solid ${meta.color}26`
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                marginBottom: 6
                              }}
                            >
                              <span
                                style={{
                                  color: "#e2e8f0",
                                  fontSize: 12,
                                  fontWeight: 600
                                }}
                              >
                                {meta.displayName}
                              </span>
                              <span
                                style={{
                                  ...recommendationStyle(
                                    artifact.recommendation
                                  ),
                                  borderRadius: 4,
                                  padding: "2px 6px",
                                  fontSize: 10,
                                  fontWeight: 700
                                }}
                              >
                                {prettyKey(artifact.recommendation)}
                              </span>
                            </div>
                            {evidenceLines.length > 0 ? (
                              <div style={{ display: "grid", gap: 4 }}>
                                {evidenceLines.map((line) => (
                                  <div
                                    key={line}
                                    style={{
                                      fontSize: 11,
                                      color: "#94a3b8",
                                      lineHeight: 1.4
                                    }}
                                  >
                                    {line}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div
                                style={{
                                  fontSize: 11,
                                  color: "#64748b",
                                  lineHeight: 1.4
                                }}
                              >
                                No explicit evidence lines provided by this
                                artifact.
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#64748b",
                        letterSpacing: "0.08em",
                        marginBottom: 10
                      }}
                    >
                      PANEL FEEDBACK — click any card to expand
                    </div>
                    <div style={{ display: "grid", gap: 8 }}>
                      {scorecard.agentArtifacts.map((a, i) => (
                        <AgentFeedbackCard key={i} artifact={a} />
                      ))}
                    </div>
                  </div>
                )}

              <div style={{ marginBottom: 16 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#64748b",
                    letterSpacing: "0.08em",
                    marginBottom: 10
                  }}
                >
                  INTERVIEW TRANSCRIPT (MANAGER REVIEW)
                </div>
                <div
                  style={{
                    borderRadius: 8,
                    background: "rgba(2,6,23,0.5)",
                    border: "1px solid rgba(148,163,184,0.12)",
                    maxHeight: 320,
                    overflowY: "auto",
                    padding: "10px 12px",
                    display: "grid",
                    gap: 8
                  }}
                >
                  {transcriptLoading ? (
                    <div style={{ fontSize: 12, color: "#64748b" }}>
                      Loading transcript…
                    </div>
                  ) : transcript.length === 0 ? (
                    <div style={{ fontSize: 12, color: "#64748b" }}>
                      No transcript captured for this interview.
                    </div>
                  ) : (
                    transcript.map((turn, idx) => (
                      <div
                        key={`${turn.role}-${idx}-${turn.text.slice(0, 24)}`}
                        style={{
                          padding: "8px 10px",
                          borderRadius: 6,
                          background:
                            turn.role === "candidate"
                              ? "rgba(37,99,235,0.08)"
                              : "rgba(99,102,241,0.08)",
                          border:
                            turn.role === "candidate"
                              ? "1px solid rgba(59,130,246,0.18)"
                              : "1px solid rgba(99,102,241,0.18)"
                        }}
                      >
                        <div
                          style={{
                            fontSize: 10.5,
                            fontWeight: 700,
                            color:
                              turn.role === "candidate" ? "#93c5fd" : "#a5b4fc",
                            letterSpacing: "0.06em",
                            marginBottom: 4
                          }}
                        >
                          {turn.role === "candidate"
                            ? "Candidate"
                            : turn.speaker || "Panel"}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: "#cbd5e1",
                            lineHeight: 1.5,
                            whiteSpace: "pre-wrap" as const
                          }}
                        >
                          {turn.text}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {canTakeDecision && (
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#64748b",
                      letterSpacing: "0.08em",
                      marginBottom: 10
                    }}
                  >
                    YOUR DECISION
                  </div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                    {(["hire", "follow-up", "reject"] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setDecision(d)}
                        style={{
                          flex: 1,
                          padding: "7px 0",
                          borderRadius: 6,
                          cursor: "pointer",
                          fontSize: 12,
                          fontWeight: 600,
                          border: `1px solid ${
                            decision === d
                              ? d === "hire"
                                ? "rgba(52,211,153,0.5)"
                                : d === "reject"
                                  ? "rgba(248,113,113,0.5)"
                                  : "rgba(251,191,36,0.5)"
                              : "rgba(148,163,184,0.15)"
                          }`,
                          background:
                            decision === d
                              ? d === "hire"
                                ? "rgba(52,211,153,0.12)"
                                : d === "reject"
                                  ? "rgba(248,113,113,0.12)"
                                  : "rgba(251,191,36,0.12)"
                              : "transparent",
                          color:
                            decision === d
                              ? d === "hire"
                                ? "#34d399"
                                : d === "reject"
                                  ? "#f87171"
                                  : "#fbbf24"
                              : "#64748b",
                          textTransform: "capitalize" as const
                        }}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={decisionNote}
                    onChange={(e) => setDecisionNote(e.target.value)}
                    placeholder="Decision rationale (optional)..."
                    rows={2}
                    style={{
                      ...inputStyle,
                      width: "100%",
                      resize: "none",
                      marginBottom: 10
                    }}
                  />
                  <button
                    type="button"
                    onClick={submitDecision}
                    disabled={deciding}
                    style={{ ...btnPrimary, width: "100%" }}
                  >
                    {deciding
                      ? "Submitting..."
                      : `Submit Decision: ${decision}`}
                  </button>
                </div>
              )}

              {selectedInterview.decision && (
                <div
                  style={{
                    padding: "10px 14px",
                    borderRadius: 6,
                    background: "rgba(52,211,153,0.08)",
                    border: "1px solid rgba(52,211,153,0.2)",
                    fontSize: 13,
                    color: "#34d399"
                  }}
                >
                  Decision recorded:{" "}
                  <strong>{selectedInterview.decision}</strong>
                </div>
              )}
            </>
          ) : (
            <div
              style={{
                color: "#475569",
                fontSize: 13,
                textAlign: "center" as const,
                padding: "20px 0"
              }}
            >
              <ChartBarIcon
                size={24}
                style={{ opacity: 0.4, marginBottom: 8 }}
              />
              <div>Scorecard will appear after the interview completes.</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({
  icon,
  message
}: {
  icon: React.ReactNode;
  message: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column" as const,
        alignItems: "center",
        padding: "48px 24px",
        color: "#475569",
        gap: 12
      }}
    >
      <div style={{ opacity: 0.4 }}>{icon}</div>
      <div style={{ fontSize: 13 }}>{message}</div>
    </div>
  );
}

// ─── Shared styles ─────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  background: "rgba(2,6,23,0.6)",
  border: "1px solid rgba(148,163,184,0.18)",
  borderRadius: 6,
  padding: "7px 12px",
  color: "#e7edf8",
  fontSize: 13,
  outline: "none",
  width: "100%",
  boxSizing: "border-box" as const
};

const btnPrimary: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  padding: "7px 16px",
  borderRadius: 6,
  cursor: "pointer",
  background: "rgba(99,102,241,0.2)",
  border: "1px solid rgba(99,102,241,0.4)",
  color: "#a5b4fc",
  fontSize: 13,
  fontWeight: 600
};

const btnGhost: React.CSSProperties = {
  padding: "7px 14px",
  borderRadius: 6,
  cursor: "pointer",
  background: "transparent",
  border: "1px solid rgba(148,163,184,0.18)",
  color: "#64748b",
  fontSize: 13
};

const btnApprove: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 5,
  borderRadius: 6,
  cursor: "pointer",
  background: "rgba(52,211,153,0.1)",
  border: "1px solid rgba(52,211,153,0.3)",
  color: "#34d399",
  fontSize: 13,
  fontWeight: 600
};

const btnReject: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 5,
  borderRadius: 6,
  cursor: "pointer",
  background: "rgba(248,113,113,0.1)",
  border: "1px solid rgba(248,113,113,0.3)",
  color: "#f87171",
  fontSize: 13,
  fontWeight: 600
};

// ─── Dashboard Root ────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [tab, setTab] = useState<Tab>("jobs");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [jr, ir] = await Promise.all([
        fetch("/api/jobs").then((r) => r.json()),
        fetch("/api/interviews").then((r) => r.json())
      ]);
      const jobList: Job[] = Array.isArray(jr)
        ? (jr as Job[])
        : ((jr as { jobs?: Job[] }).jobs ?? []);
      setJobs(jobList);

      const interviewList: Interview[] = Array.isArray(ir)
        ? (ir as Interview[])
        : ((ir as { interviews?: Interview[] }).interviews ?? []);
      setInterviews(interviewList);

      // Load candidates for all jobs
      const allCandidates: Candidate[] = [];
      await Promise.all(
        jobList.map(async (j) => {
          try {
            const cr = await fetch(`/api/jobs/${j.id}/candidates`).then((r) =>
              r.json()
            );
            const candidateList: Candidate[] = Array.isArray(cr)
              ? (cr as Candidate[])
              : ((cr as { candidates?: Candidate[] }).candidates ?? []);
            allCandidates.push(...candidateList);
          } catch (_) {}
        })
      );
      setCandidates(allCandidates);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    const onReload = () => {
      void loadAll();
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === DASHBOARD_RELOAD_STORAGE_KEY) {
        void loadAll();
      }
    };

    window.addEventListener("dashboard:reload", onReload);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("dashboard:reload", onReload);
      window.removeEventListener("storage", onStorage);
    };
  }, [loadAll]);

  const handleJobSelect = (id: string) => {
    setSelectedJobId(id);
    setTab("candidates");
  };

  const visibleCandidates = selectedJobId
    ? candidates.filter((c) => c.jobId === selectedJobId)
    : candidates;

  const TAB_CONFIG: Array<{
    id: Tab;
    label: string;
    icon: React.ReactNode;
    count?: number;
  }> = [
    {
      id: "jobs",
      label: "Jobs",
      icon: <BriefcaseIcon size={15} />,
      count: jobs.length
    },
    {
      id: "candidates",
      label: "Candidates",
      icon: <UsersIcon size={15} />,
      count:
        visibleCandidates.filter((c) => c.status === "shortlisted").length ||
        undefined
    },
    {
      id: "interviews",
      label: "Interviews",
      icon: <CalendarIcon size={15} />,
      count:
        interviews.filter((i) => i.status === "deliberation").length ||
        undefined
    }
  ];

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "linear-gradient(135deg, #020617 0%, #0b1120 45%, #020617 100%)"
      }}
    >
      {/* Header */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 28px",
          borderBottom: "1px solid rgba(148,163,184,0.1)",
          background: "rgba(2,6,23,0.85)",
          backdropFilter: "blur(16px)"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#6366f1",
              boxShadow: "0 0 10px #6366f1aa"
            }}
          />
          <span
            style={{
              fontWeight: 700,
              fontSize: 15,
              color: "#e7edf8",
              letterSpacing: "0.05em"
            }}
          >
            PanelAI
          </span>
          <span style={{ fontSize: 12, color: "#475569" }}>
            · Hiring Manager Dashboard
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button type="button" onClick={loadAll} style={btnGhost}>
            Refresh
          </button>
          <a
            href="/"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              borderRadius: 6,
              textDecoration: "none",
              background: "rgba(99,102,241,0.12)",
              border: "1px solid rgba(99,102,241,0.3)",
              color: "#a5b4fc",
              fontSize: 13
            }}
          >
            <ArrowLeftIcon size={14} /> Candidate View
          </a>
        </div>
      </header>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 24px" }}>
        {/* Summary cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 14,
            marginBottom: 28
          }}
        >
          {[
            {
              label: "Open Roles",
              value: jobs.length,
              color: "#6366f1",
              icon: <BriefcaseIcon size={18} />
            },
            {
              label: "Candidates",
              value: candidates.length,
              color: "#3b82f6",
              icon: <UsersIcon size={18} />
            },
            {
              label: "Pending Review",
              value: candidates.filter((c) => c.status === "shortlisted")
                .length,
              color: "#fbbf24",
              icon: <ClockIcon size={18} />
            },
            {
              label: "Decisions Made",
              value: interviews.filter((i) => !!i.decision).length,
              color: "#34d399",
              icon: <StarIcon size={18} />
            }
          ].map((card) => (
            <div
              key={card.label}
              style={{
                padding: "16px 18px",
                borderRadius: 10,
                background: "rgba(2,6,23,0.5)",
                border: "1px solid rgba(148,163,184,0.1)"
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start"
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "#64748b",
                      fontWeight: 600,
                      letterSpacing: "0.06em",
                      marginBottom: 8
                    }}
                  >
                    {card.label.toUpperCase()}
                  </div>
                  <div
                    style={{
                      fontSize: 28,
                      fontWeight: 700,
                      color: card.color,
                      lineHeight: 1
                    }}
                  >
                    {card.value}
                  </div>
                </div>
                <div style={{ color: card.color, opacity: 0.6 }}>
                  {card.icon}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div
          style={{
            display: "flex",
            gap: 4,
            marginBottom: 24,
            borderBottom: "1px solid rgba(148,163,184,0.1)",
            paddingBottom: 0
          }}
        >
          {TAB_CONFIG.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                if (t.id !== "candidates") setSelectedJobId(null);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "9px 16px",
                borderRadius: "6px 6px 0 0",
                background:
                  tab === t.id ? "rgba(99,102,241,0.12)" : "transparent",
                border:
                  tab === t.id
                    ? "1px solid rgba(99,102,241,0.3)"
                    : "1px solid transparent",
                borderBottom:
                  tab === t.id
                    ? "1px solid rgba(2,6,23,0.6)"
                    : "1px solid transparent",
                color: tab === t.id ? "#a5b4fc" : "#64748b",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: tab === t.id ? 600 : 400,
                marginBottom: -1
              }}
            >
              {t.icon}
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span
                  style={{
                    background: "rgba(251,191,36,0.2)",
                    color: "#fbbf24",
                    borderRadius: 99,
                    padding: "0px 6px",
                    fontSize: 10,
                    fontWeight: 700
                  }}
                >
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Selected job filter badge */}
        {selectedJobId && tab === "candidates" && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 16
            }}
          >
            <span style={{ fontSize: 12, color: "#64748b" }}>Filtered by:</span>
            <span
              style={{
                padding: "2px 10px",
                borderRadius: 4,
                background: "rgba(99,102,241,0.15)",
                color: "#a5b4fc",
                fontSize: 12
              }}
            >
              {jobs.find((j) => j.id === selectedJobId)?.title ?? selectedJobId}
            </span>
            <button
              type="button"
              onClick={() => setSelectedJobId(null)}
              style={{ ...btnGhost, padding: "2px 8px", fontSize: 11 }}
            >
              Clear
            </button>
          </div>
        )}

        {/* Tab content */}
        {loading ? (
          <div
            style={{
              color: "#475569",
              textAlign: "center" as const,
              padding: "40px 0"
            }}
          >
            Loading...
          </div>
        ) : (
          <>
            {tab === "jobs" && (
              <JobsTab jobs={jobs} onSelect={handleJobSelect} />
            )}
            {tab === "candidates" && (
              <CandidatesTab
                candidates={visibleCandidates}
                jobs={jobs}
                selectedJobId={selectedJobId}
              />
            )}
            {tab === "interviews" && (
              <InterviewsTab
                interviews={interviews}
                candidates={candidates}
                jobs={jobs}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
