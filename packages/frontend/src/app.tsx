/** biome-ignore-all lint/correctness/useUniqueElementIds: it's alright */
import { useEffect, useState, useRef, useCallback } from "react";
import { useAgent } from "agents/react";
import { isStaticToolUIPart } from "ai";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import type { UIMessage } from "@ai-sdk/react";

import { MemoizedMarkdown } from "@/components/memoized-markdown";
import { ToolInvocationCard } from "@/components/tool-invocation-card/ToolInvocationCard";
import {
  MicrophoneIcon,
  PaperPlaneTiltIcon,
  StopIcon,
  TrashIcon
} from "@phosphor-icons/react";

// ─── Agent definitions ────────────────────────────────────────────────────────

type Agent = {
  id: string;
  name: string;
  role: string;
  color: string;
  voice: string;
  avatar: string; // Avatar URL
};

type InterviewSessionContext = {
  jobId: string;
  candidateId: string;
  interviewId: string;
};

const AGENTS: Agent[] = [
  {
    id: "orchestrator",
    name: "Alex Monroe",
    role: "Interview Moderator",
    color: "#8B5CF6",
    voice: "athena",
    avatar: "https://randomuser.me/api/portraits/men/75.jpg"
  },
  {
    id: "hr",
    name: "Sarah Park",
    role: "HR & Recruiter",
    color: "#3B82F6",
    voice: "asteria",
    avatar: "https://randomuser.me/api/portraits/women/68.jpg"
  },
  {
    id: "technical",
    name: "Dr. Raj Patel",
    role: "Technical Lead",
    color: "#06B6D4",
    voice: "orion",
    avatar: "https://randomuser.me/api/portraits/men/11.jpg"
  },
  {
    id: "culture",
    name: "Maya Chen",
    role: "Culture & Values",
    color: "#10B981",
    voice: "luna",
    avatar: "https://randomuser.me/api/portraits/women/44.jpg"
  },
  {
    id: "domain",
    name: "James Liu",
    role: "Domain Expert",
    color: "#F59E0B",
    voice: "orpheus",
    avatar: "https://randomuser.me/api/portraits/men/81.jpg"
  },
  {
    id: "behavioral",
    name: "Lisa Torres",
    role: "Behavioral Analyst",
    color: "#EC4899",
    voice: "stella",
    avatar: "https://randomuser.me/api/portraits/women/53.jpg"
  }
];

const TOOLS_REQUIRING_CONFIRMATION = ["getWeatherInformation"];
const LIVE_JOB_STORAGE_KEY = "panelai:live-job-id";
const INTERVIEW_SESSION_STORAGE_KEY = "panelai:active-interview-session";
const DASHBOARD_RELOAD_STORAGE_KEY = "panelai:dashboard:needs-reload";

function textIndicatesInterviewClosing(text: string): boolean {
  return /\b(before we conclude|as we conclude|to conclude|wrap up|wrap-up|panel will deliberate|we(?:'| )?ll deliberate|do you have any questions for the panel|any questions for the panel|thanks for your thoughtful responses today)\b/i.test(
    text
  );
}

function agentById(id: string): Agent {
  return AGENTS.find((a) => a.id === id) ?? AGENTS[0];
}

function getMessageText(message: UIMessage): string {
  return (message.parts ?? [])
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n")
    .trim();
}

function sanitizeAssistantTextForDisplay(text: string): string {
  const speakerNamePattern =
    /alex monroe|sarah park|dr\.?\s*raj patel|maya chen|james liu|lisa torres/gi;
  const speakerTagPattern =
    /^\s*\(?\s*(?:alex monroe|sarah park|dr\.?\s*raj patel|maya chen|james liu|lisa torres)\s*\)?\s*[:-]\s*/i;

  const cleanedLines = text
    .replace(/\[MEMORY:[^\]]+\]/gi, "")
    .replace(
      new RegExp(`\\(\\s*(?:${speakerNamePattern.source})\\s*\\)`, "gi"),
      ""
    )
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^\s*memory\s*:/i.test(line))
    .map((line) => line.replace(speakerTagPattern, ""))
    .filter((line) => line.length > 0);

  return cleanedLines.join("\n").trim();
}

// ─── Speaker detection ────────────────────────────────────────────────────────

const SPEAKER_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  {
    id: "orchestrator",
    pattern: /^(?:alex monroe|alex|moderator|orchestrator)\s*[:-]\s*/i
  },
  { id: "hr", pattern: /^(?:sarah park|sarah)\s*[:-]\s*/i },
  {
    id: "technical",
    pattern: /^(?:dr\.?\s*raj patel|raj patel|dr\.?\s*raj|raj)\s*[:-]\s*/i
  },
  { id: "culture", pattern: /^(?:maya chen|maya)\s*[:-]\s*/i },
  { id: "domain", pattern: /^(?:james liu|james)\s*[:-]\s*/i },
  { id: "behavioral", pattern: /^(?:lisa torres|lisa)\s*[:-]\s*/i }
];

function detectAgentId(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    for (const { id, pattern } of SPEAKER_PATTERNS) {
      if (pattern.test(line)) return id;
    }
  }

  const opener = (lines[0] ?? text).toLowerCase();
  if (/\b(?:i[' ]?m|i am|this is)\s+alex\b/.test(opener)) return "orchestrator";
  if (/\b(?:i[' ]?m|i am|this is)\s+sarah\b/.test(opener)) return "hr";
  if (/\b(?:i[' ]?m|i am|this is)\s+(?:dr\.?\s*raj|raj)\b/.test(opener))
    return "technical";
  if (/\b(?:i[' ]?m|i am|this is)\s+maya\b/.test(opener)) return "culture";
  if (/\b(?:i[' ]?m|i am|this is)\s+james\b/.test(opener)) return "domain";
  if (/\b(?:i[' ]?m|i am|this is)\s+lisa\b/.test(opener)) return "behavioral";

  return null;
}

// ─── Agent avatar component ───────────────────────────────────────────────────

function AgentAvatar({
  agent,
  size = 48,
  glow = false,
  pulse = false
}: {
  agent: Agent;
  size?: number;
  glow?: boolean;
  pulse?: boolean;
}) {
  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          overflow: "hidden",
          border: `2px solid ${glow ? agent.color : "rgba(148,163,184,0.15)"}`,
          boxShadow: glow ? `0 0 20px ${agent.color}55` : "none",
          background: `${agent.color}22`,
          transition: "all 0.3s ease",
          flexShrink: 0
        }}
      >
        <img
          src={agent.avatar}
          alt={agent.name}
          width={size}
          height={size}
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            objectFit: "cover"
          }}
          onError={(e) => {
            // Fallback to initials if avatar fails to load
            const el = e.currentTarget;
            el.style.display = "none";
            const parent = el.parentElement;
            if (parent) {
              parent.style.display = "flex";
              parent.style.alignItems = "center";
              parent.style.justifyContent = "center";
              parent.style.fontSize = `${size * 0.3}px`;
              parent.style.fontWeight = "700";
              parent.style.color = agent.color;
              parent.textContent = agent.name
                .split(" ")
                .map((w) => w[0])
                .join("");
            }
          }}
        />
      </div>
      {pulse && (
        <div
          style={{
            position: "absolute",
            inset: -3,
            borderRadius: "50%",
            border: `2px solid ${agent.color}66`,
            animation: "pulse-ring 1.8s ease-out infinite"
          }}
        />
      )}
    </div>
  );
}

// ─── Provider check ───────────────────────────────────────────────────────────

type ProviderStatus =
  | { loading: true }
  | { loading: false; success: boolean; provider?: string };

function HasProviderReady() {
  const [status, setStatus] = useState<ProviderStatus>({ loading: true });

  useEffect(() => {
    let mounted = true;
    fetch("/api/provider/status")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => {
        const payload = d as { success?: boolean; provider?: string };
        if (mounted) {
          setStatus({
            loading: false,
            success: Boolean(payload.success),
            provider: payload.provider
          });
        }
      })
      .catch(() => {
        if (mounted) setStatus({ loading: false, success: false });
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (status.loading || status.success) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 60,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 100,
        padding: "10px 20px",
        borderRadius: 8,
        background: "rgba(239,68,68,0.12)",
        border: "1px solid rgba(239,68,68,0.3)",
        color: "#fca5a5",
        fontSize: 13,
        textAlign: "center" as const,
        maxWidth: 400
      }}
    >
      ⚠ AI provider not configured. Add <code>AI_API_KEY</code> to{" "}
      <code>.dev.vars</code>.
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PanelInterview() {
  const [activeSpeakerId, setActiveSpeakerId] = useState("orchestrator");
  const [seenAgents, setSeenAgents] = useState<Set<string>>(
    new Set(["orchestrator"])
  );
  const [messageAgentMap, setMessageAgentMap] = useState<
    Record<string, string>
  >({});
  const [isRecording, setRecording] = useState(false);
  const [isTranscribing, setTranscribing] = useState(false);
  const [input, setInput] = useState("");
  const lastProcessedId = useRef<string | null>(null);
  const lastSpoken = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const [sessionContext, setSessionContext] =
    useState<InterviewSessionContext | null>(null);
  const panelRunTriggeredRef = useRef(false);

  const agent = useAgent({ agent: "chat", name: "candidate" });
  const { messages, clearHistory, status, sendMessage, stop, addToolResult } =
    useAgentChat<unknown, UIMessage<{ createdAt: string }>>({ agent });

  const currentAgent = agentById(activeSpeakerId);
  const isStreaming = status === "streaming";

  const ensureInterviewSession = useCallback(
    async (forceNew = false): Promise<InterviewSessionContext | null> => {
      const validateInterviewSession = async (
        candidate: InterviewSessionContext
      ): Promise<boolean> => {
        try {
          const response = await fetch(
            `/api/interviews/${candidate.interviewId}`
          );
          return response.ok;
        } catch {
          return false;
        }
      };

      if (!forceNew) {
        const raw = sessionStorage.getItem(INTERVIEW_SESSION_STORAGE_KEY);
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as InterviewSessionContext;
            if (
              parsed?.jobId &&
              parsed?.candidateId &&
              parsed?.interviewId &&
              (await validateInterviewSession(parsed))
            ) {
              setSessionContext(parsed);
              return parsed;
            }
          } catch {
            // Ignore invalid local session state and recreate it.
          }
        }
      }

      const ensureLiveJob = async (): Promise<string> => {
        const existingJobId = localStorage.getItem(LIVE_JOB_STORAGE_KEY);
        if (existingJobId) {
          try {
            const response = await fetch(`/api/jobs/${existingJobId}`);
            if (response.ok) {
              return existingJobId;
            }
          } catch {
            // Fall through and recreate the live job.
          }
        }

        const createdAtLabel = new Date().toLocaleDateString();
        const createJobResponse = await fetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Live Candidate Interview",
            department: "Interview Ops",
            location: "Remote",
            level: "mid",
            employmentType: "full-time",
            remotePolicy: "remote",
            description: `Auto-created from candidate interview UI on ${createdAtLabel}.`
          })
        });

        if (!createJobResponse.ok) {
          throw new Error("Failed to create live interview job");
        }

        const jobPayload = (await createJobResponse.json()) as { id: string };
        localStorage.setItem(LIVE_JOB_STORAGE_KEY, jobPayload.id);
        return jobPayload.id;
      };

      try {
        const jobId = await ensureLiveJob();

        const createCandidateResponse = await fetch(
          `/api/jobs/${jobId}/candidates`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              profile: {
                name: "Live Candidate",
                email: "candidate@panelai.local"
              }
            })
          }
        );

        if (!createCandidateResponse.ok) {
          throw new Error("Failed to create candidate record");
        }

        const candidatePayload = (await createCandidateResponse.json()) as {
          id: string;
        };

        const createInterviewResponse = await fetch("/api/interviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId,
            candidateId: candidatePayload.id
          })
        });

        if (!createInterviewResponse.ok) {
          throw new Error("Failed to create interview record");
        }

        const interviewPayload = (await createInterviewResponse.json()) as {
          id: string;
        };

        const created: InterviewSessionContext = {
          jobId,
          candidateId: candidatePayload.id,
          interviewId: interviewPayload.id
        };

        sessionStorage.setItem(
          INTERVIEW_SESSION_STORAGE_KEY,
          JSON.stringify(created)
        );
        setSessionContext(created);
        return created;
      } catch (error) {
        console.error("Unable to initialize interview session:", error);
        return null;
      }
    },
    []
  );

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (messages.length > 0) scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    void ensureInterviewSession();
  }, [ensureInterviewSession]);

  useEffect(() => {
    const latest = messages[messages.length - 1];
    if (
      !latest ||
      latest.role !== "assistant" ||
      status !== "ready" ||
      !sessionContext ||
      panelRunTriggeredRef.current
    ) {
      return;
    }

    const latestText = getMessageText(latest);
    if (!latestText || !textIndicatesInterviewClosing(latestText)) {
      return;
    }

    panelRunTriggeredRef.current = true;

    void (async () => {
      try {
        const response = await fetch("/api/interview/run-panel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            interviewId: sessionContext.interviewId,
            candidateId: sessionContext.candidateId
          })
        });

        if (!response.ok) {
          panelRunTriggeredRef.current = false;
          return;
        }

        window.dispatchEvent(new CustomEvent("dashboard:reload"));
        localStorage.setItem(DASHBOARD_RELOAD_STORAGE_KEY, String(Date.now()));
      } catch (error) {
        console.error("Unable to finalize interview panel run:", error);
        panelRunTriggeredRef.current = false;
      }
    })();
  }, [messages, sessionContext, status]);

  // TTS is disabled per user request - keeping hook structure in place
  const speakResponse = useCallback(async (_text: string, _voice: string) => {
    // TTS disabled
  }, []);

  // Detect active speaker from new assistant messages
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant" || status !== "ready") return;
    if (lastProcessedId.current === last.id) return;
    lastProcessedId.current = last.id;

    const text = getMessageText(last);
    if (!text || text === lastSpoken.current) return;
    lastSpoken.current = text;

    const detected = detectAgentId(text) ?? activeSpeakerId;
    setActiveSpeakerId(detected);
    setSeenAgents((prev) => new Set([...prev, detected]));
    setMessageAgentMap((prev) => ({ ...prev, [last.id]: detected }));
    speakResponse(text, agentById(detected).voice);
  }, [messages, status, activeSpeakerId, speakResponse]);

  function getMsgAgent(msg: UIMessage): Agent {
    const mapped = messageAgentMap[msg.id];
    if (mapped) return agentById(mapped);
    const text = getMessageText(msg);
    const detected = detectAgentId(text);
    if (detected) return agentById(detected);
    return currentAgent;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    const text = input;
    setInput("");
    await sendMessage({ role: "user", parts: [{ type: "text", text }] });
  };

  const handleVoiceInput = async () => {
    if (isRecording) {
      mediaRecorder.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      mediaRecorder.current = rec;
      audioChunks.current = [];
      rec.ondataavailable = (ev) => audioChunks.current.push(ev.data);
      rec.onstop = async () => {
        setTranscribing(true);
        const blob = new Blob(audioChunks.current, { type: "audio/webm" });
        const fd = new FormData();
        fd.append("audio", blob);
        try {
          const res = await fetch("/transcribe", { method: "POST", body: fd });
          const data = (await res.json()) as { text?: string };
          if (data.text) {
            await sendMessage({
              role: "user",
              parts: [{ type: "text", text: data.text }]
            });
          }
        } finally {
          setTranscribing(false);
          stream.getTracks().forEach((t) => {
            t.stop();
          });
        }
      };
      rec.start();
      setRecording(true);
    } catch (err) {
      console.error("Mic error:", err);
    }
  };

  const resetSession = useCallback(() => {
    clearHistory();
    setActiveSpeakerId("orchestrator");
    setSeenAgents(new Set(["orchestrator"]));
    setMessageAgentMap({});
    lastProcessedId.current = null;
    lastSpoken.current = null;
    panelRunTriggeredRef.current = false;
    sessionStorage.removeItem(INTERVIEW_SESSION_STORAGE_KEY);
    setSessionContext(null);
    void ensureInterviewSession(true);
  }, [clearHistory, ensureInterviewSession]);

  const pendingConfirmation = messages.some((m: UIMessage) =>
    m.parts?.some(
      (p) =>
        isStaticToolUIPart(p) &&
        p.state === "input-available" &&
        TOOLS_REQUIRING_CONFIRMATION.includes(p.type.replace("tool-", ""))
    )
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{`
        @keyframes pulse-ring {
          0% { transform: scale(1); opacity: 0.7; }
          70% { transform: scale(1.25); opacity: 0; }
          100% { transform: scale(1.25); opacity: 0; }
        }
        @keyframes speaking-dots {
          0%, 80%, 100% { transform: scale(0); opacity: 0.3; }
          40% { transform: scale(1); opacity: 1; }
        }
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div
        style={{
          display: "grid",
          gridTemplateRows: "48px 1fr",
          height: "100vh",
          overflow: "hidden",
          background: "#080e1a"
        }}
      >
        <HasProviderReady />

        {/* ── Top bar ──────────────────────────────────────────────────── */}
        <header
          style={{
            display: "flex",
            alignItems: "center",
            padding: "0 20px",
            gap: 12,
            borderBottom: "1px solid rgba(148,163,184,0.08)",
            background: "rgba(8,14,26,0.95)",
            backdropFilter: "blur(8px)",
            zIndex: 10
          }}
        >
          {/* Brand */}
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "#10B981",
                boxShadow: "0 0 6px #10B98188"
              }}
            />
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "0.06em",
                color: "#e2e8f0"
              }}
            >
              PanelAI
            </span>
            <span style={{ fontSize: 11, color: "#334155" }}>
              · Live Interview
            </span>
          </div>

          {/* Agent status row - small face dots */}
          <div
            style={{
              display: "flex",
              gap: 4,
              margin: "0 auto",
              alignItems: "center"
            }}
          >
            {AGENTS.map((a) => {
              const isActive = a.id === activeSpeakerId;
              const seen = seenAgents.has(a.id);
              return (
                <div key={a.id} style={{ position: "relative" }}>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      overflow: "hidden",
                      border: `2px solid ${isActive ? a.color : seen ? `${a.color}55` : "rgba(148,163,184,0.15)"}`,
                      opacity: isActive ? 1 : seen ? 0.7 : 0.35,
                      transition: "all 0.25s ease",
                      background: `${a.color}18`
                    }}
                  >
                    <img
                      src={a.avatar}
                      alt={a.name}
                      width={28}
                      height={28}
                      style={{ display: "block" }}
                    />
                  </div>
                  {isActive && isStreaming && (
                    <div
                      style={{
                        position: "absolute",
                        bottom: -2,
                        right: -2,
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: a.color,
                        boxShadow: `0 0 4px ${a.color}`
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* Controls */}
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <a
              href="/dashboard"
              style={{
                padding: "4px 10px",
                borderRadius: 5,
                textDecoration: "none",
                background: "rgba(99,102,241,0.1)",
                border: "1px solid rgba(99,102,241,0.2)",
                color: "#a5b4fc",
                fontSize: 11,
                fontWeight: 600
              }}
            >
              Dashboard
            </a>
            <button
              type="button"
              onClick={resetSession}
              title="Reset interview"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 5,
                borderRadius: 5,
                color: "#475569",
                display: "flex",
                alignItems: "center"
              }}
            >
              <TrashIcon size={14} />
            </button>
          </div>
        </header>

        {/* ── Body ─────────────────────────────────────────────────────── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(360px, 34vw) minmax(540px, 1fr)",
            overflow: "hidden",
            height: "100%"
          }}
        >
          {/* ── Left: Active speaker panel (highlight) ─────────────────── */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              order: 2,
              borderLeft: "1px solid rgba(148,163,184,0.07)",
              padding: "26px 22px 18px",
              gap: 18,
              background: `radial-gradient(ellipse at 30% 26%, ${currentAgent.color}14 0%, transparent 62%), #070d19`
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 18
              }}
            >
              {/* Large avatar */}
              <AgentAvatar
                agent={currentAgent}
                size={166}
                glow
                pulse={isStreaming}
              />

              {/* Name + role */}
              <div style={{ textAlign: "center" as const }}>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 22,
                    color: "#e2e8f0",
                    marginBottom: 6
                  }}
                >
                  {currentAgent.name}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "#64748b",
                    letterSpacing: "0.08em"
                  }}
                >
                  {currentAgent.role.toUpperCase()}
                </div>
              </div>

              {/* Speaking status */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {isStreaming ? (
                  <>
                    <div
                      style={{ display: "flex", gap: 4, alignItems: "center" }}
                    >
                      {[0, 1, 2].map((i) => (
                        <div
                          key={i}
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: currentAgent.color,
                            animation: `speaking-dots 1.4s ease-in-out ${i * 0.16}s infinite`
                          }}
                        />
                      ))}
                    </div>
                    <span
                      style={{
                        fontSize: 12,
                        color: currentAgent.color,
                        fontWeight: 700
                      }}
                    >
                      Speaking
                    </span>
                  </>
                ) : (
                  <span style={{ fontSize: 12, color: "#334155" }}>
                    Listening
                  </span>
                )}
              </div>

              {/* Full panel lineup */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: 10,
                  width: "100%",
                  maxWidth: 360,
                  paddingTop: 16,
                  borderTop: "1px solid rgba(148,163,184,0.08)"
                }}
              >
                {AGENTS.map((a) => {
                  const isCurrent = a.id === activeSpeakerId;
                  const seen = seenAgents.has(a.id);

                  return (
                    <div
                      key={a.id}
                      title={a.name}
                      style={{ textAlign: "center" as const }}
                    >
                      <div
                        style={{
                          margin: "0 auto",
                          width: 46,
                          height: 46,
                          borderRadius: "50%",
                          overflow: "hidden",
                          border: `2px solid ${isCurrent ? a.color : seen ? `${a.color}55` : "rgba(148,163,184,0.15)"}`,
                          opacity: isCurrent ? 1 : seen ? 0.78 : 0.36,
                          boxShadow: isCurrent
                            ? `0 0 0 3px ${a.color}22`
                            : "none"
                        }}
                      >
                        <img
                          src={a.avatar}
                          alt={a.name}
                          width={46}
                          height={46}
                          style={{
                            display: "block",
                            width: "100%",
                            height: "100%",
                            objectFit: "cover"
                          }}
                        />
                      </div>
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 10,
                          color: isCurrent ? "#cbd5e1" : "#64748b",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis"
                        }}
                      >
                        {a.name.split(" ")[0]}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Response prompt (highlighted with avatar stage) */}
            <div
              style={{
                borderTop: "1px solid rgba(148,163,184,0.08)",
                paddingTop: 14,
                width: "100%"
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "#64748b",
                  marginBottom: 8,
                  letterSpacing: "0.04em"
                }}
              >
                RESPOND WITH TEXT OR VOICE
              </div>

              <form
                onSubmit={handleSubmit}
                style={{ display: "flex", gap: 8, alignItems: "flex-end" }}
              >
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit(e as unknown as React.FormEvent);
                    }
                  }}
                  placeholder="Type your response... (Enter to send)"
                  rows={3}
                  disabled={isStreaming || pendingConfirmation}
                  style={{
                    flex: 1,
                    background: "rgba(15,23,42,0.8)",
                    border: `1px solid ${currentAgent.color}33`,
                    borderRadius: 10,
                    padding: "10px 14px",
                    color: "#cbd5e1",
                    fontSize: 13.5,
                    resize: "none",
                    outline: "none",
                    fontFamily: "inherit",
                    lineHeight: 1.5
                  }}
                />

                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    onClick={handleVoiceInput}
                    disabled={
                      isStreaming || isTranscribing || pendingConfirmation
                    }
                    title={isRecording ? "Stop recording" : "Voice input"}
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 10,
                      border: "none",
                      cursor: "pointer",
                      background: isRecording
                        ? "rgba(239,68,68,0.2)"
                        : "rgba(148,163,184,0.08)",
                      color: isRecording ? "#f87171" : "#64748b",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "all 0.15s"
                    }}
                  >
                    {isTranscribing ? (
                      <div
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: "50%",
                          border: "2px solid #64748b",
                          borderTopColor: "transparent",
                          animation: "spin 0.8s linear infinite"
                        }}
                      />
                    ) : isRecording ? (
                      <StopIcon size={16} />
                    ) : (
                      <MicrophoneIcon size={16} />
                    )}
                  </button>

                  <button
                    type={isStreaming ? "button" : "submit"}
                    onClick={isStreaming ? stop : undefined}
                    disabled={!isStreaming && !input.trim()}
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 10,
                      border: "none",
                      cursor: "pointer",
                      background: isStreaming
                        ? "rgba(239,68,68,0.15)"
                        : `${currentAgent.color}33`,
                      color: isStreaming ? "#f87171" : "#dbeafe",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "all 0.15s"
                    }}
                  >
                    {isStreaming ? (
                      <StopIcon size={16} />
                    ) : (
                      <PaperPlaneTiltIcon size={16} />
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* ── Right: Compact transcript panel ────────────────────────── */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              order: 1
            }}
          >
            <div
              style={{
                flexShrink: 0,
                padding: "12px 16px",
                borderBottom: "1px solid rgba(148,163,184,0.08)",
                fontSize: 11,
                letterSpacing: "0.08em",
                color: "#64748b"
              }}
            >
              LIVE TRANSCRIPT
            </div>

            {/* Messages */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "14px 14px 18px",
                display: "flex",
                flexDirection: "column",
                gap: 10
              }}
            >
              {messages.length === 0 && (
                <div
                  style={{
                    margin: "auto",
                    textAlign: "center" as const,
                    color: "#334155",
                    fontSize: 14,
                    padding: "40px 20px"
                  }}
                >
                  <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.4 }}>
                    👋
                  </div>
                  <div>The interview panel is ready.</div>
                  <div style={{ fontSize: 12, color: "#1e293b", marginTop: 4 }}>
                    Say hello or introduce yourself to begin.
                  </div>
                </div>
              )}

              {messages.map((msg) => {
                const isUser = msg.role === "user";
                const msgAgent = isUser ? null : getMsgAgent(msg);

                return (
                  <div
                    key={msg.id}
                    style={{
                      display: "flex",
                      flexDirection: isUser ? "row-reverse" : "row",
                      gap: 10,
                      alignItems: "flex-start",
                      animation: "fade-up 0.3s ease-out"
                    }}
                  >
                    {/* Avatar */}
                    {!isUser && msgAgent && (
                      <AgentAvatar agent={msgAgent} size={32} />
                    )}

                    {/* Bubble */}
                    <div
                      style={{
                        maxWidth: "95%",
                        display: "flex",
                        flexDirection: "column",
                        gap: 3
                      }}
                    >
                      {!isUser && msgAgent && (
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: msgAgent.color,
                            paddingLeft: 2
                          }}
                        >
                          {msgAgent.name}
                        </span>
                      )}
                      <div
                        style={{
                          padding: "10px 14px",
                          borderRadius: isUser
                            ? "12px 12px 4px 12px"
                            : "4px 12px 12px 12px",
                          background: isUser
                            ? "linear-gradient(135deg, #1d4ed8, #0369a1)"
                            : "rgba(15,23,42,0.75)",
                          border: isUser
                            ? "1px solid rgba(125,211,252,0.2)"
                            : `1px solid ${msgAgent ? `${msgAgent.color}22` : "rgba(148,163,184,0.1)"}`,
                          borderLeft: isUser
                            ? undefined
                            : `3px solid ${msgAgent?.color ?? "rgba(148,163,184,0.3)"}`,
                          fontSize: 13.5,
                          lineHeight: 1.6,
                          color: isUser ? "#eff6ff" : "#cbd5e1"
                        }}
                      >
                        {msg.parts?.map((part, i) => {
                          if (part.type === "text") {
                            const content = isUser
                              ? part.text
                              : sanitizeAssistantTextForDisplay(part.text);

                            if (!content) {
                              return null;
                            }

                            return (
                              <MemoizedMarkdown
                                key={i}
                                id={`${msg.id}-${i}`}
                                content={content}
                              />
                            );
                          }
                          if (isStaticToolUIPart(part)) {
                            const toolName = part.type.replace("tool-", "");
                            return (
                              <ToolInvocationCard
                                key={`${part.toolCallId}-${i}`}
                                toolUIPart={part}
                                toolCallId={part.toolCallId}
                                needsConfirmation={TOOLS_REQUIRING_CONFIRMATION.includes(
                                  toolName
                                )}
                                onSubmit={({ toolCallId, result }) =>
                                  addToolResult({
                                    tool: toolName,
                                    toolCallId,
                                    output: result
                                  })
                                }
                                addToolResult={(toolCallId, result) =>
                                  addToolResult({
                                    tool: toolName,
                                    toolCallId,
                                    output: result
                                  })
                                }
                              />
                            );
                          }
                          return null;
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Typing indicator */}
              {isStreaming && (
                <div
                  style={{ display: "flex", gap: 10, alignItems: "flex-start" }}
                >
                  <AgentAvatar agent={currentAgent} size={32} />
                  <div
                    style={{
                      padding: "12px 16px",
                      borderRadius: "4px 12px 12px 12px",
                      background: "rgba(15,23,42,0.75)",
                      border: `1px solid ${currentAgent.color}22`,
                      borderLeft: `3px solid ${currentAgent.color}`,
                      display: "flex",
                      gap: 5,
                      alignItems: "center"
                    }}
                  >
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        style={{
                          width: 5,
                          height: 5,
                          borderRadius: "50%",
                          background: currentAgent.color,
                          animation: `speaking-dots 1.4s ease-in-out ${i * 0.16}s infinite`
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
