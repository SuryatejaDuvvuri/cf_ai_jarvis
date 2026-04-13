/** biome-ignore-all lint/correctness/useUniqueElementIds: it's alright */
import { useEffect, useState, useRef, useCallback, use } from "react";
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
  CheckCircleIcon,
  ClockIcon,
  CaretRightIcon,
  SunIcon,
  MoonIcon,
  TrashIcon,
  BriefcaseIcon,
  CodeIcon,
  HeartIcon,
  StarIcon,
  UserIcon,
  CrownSimpleIcon
} from "@phosphor-icons/react";

// ─── Agent roster ─────────────────────────────────────────────────────────────

type AgentStatus = "waiting" | "active" | "done" | "moderating";

type Agent = {
  id: string;
  name: string;
  role: string;
  initials: string;
  color: string;
  voice: string;
  icon: React.ReactNode;
  description: string;
};

const AGENTS: Agent[] = [
  {
    id: "orchestrator",
    name: "Alex Monroe",
    role: "Interview Orchestrator",
    initials: "AM",
    color: "#8B5CF6",
    voice: "orion",
    icon: <CrownSimpleIcon size={12} weight="fill" />,
    description: "Manages the panel, ensures smooth flow"
  },
  {
    id: "recruiter",
    name: "Sarah Park",
    role: "HR & Recruiter",
    initials: "SP",
    color: "#3B82F6",
    voice: "asteria",
    icon: <BriefcaseIcon size={12} weight="fill" />,
    description: "Evaluates fit, logistics & compensation"
  },
  {
    id: "technical",
    name: "Dr. Raj Patel",
    role: "Technical Interviewer",
    initials: "RP",
    color: "#06B6D4",
    voice: "arcas",
    icon: <CodeIcon size={12} weight="fill" />,
    description: "Assesses technical skills & problem solving"
  },
  {
    id: "culture",
    name: "Maya Chen",
    role: "Culture & Values",
    initials: "MC",
    color: "#10B981",
    voice: "luna",
    icon: <HeartIcon size={12} weight="fill" />,
    description: "Evaluates team fit & company values"
  },
  {
    id: "domain",
    name: "James Liu",
    role: "Domain Expert",
    initials: "JL",
    color: "#F59E0B",
    voice: "helios",
    icon: <StarIcon size={12} weight="fill" />,
    description: "Deep dives into domain knowledge"
  },
  {
    id: "behavioral",
    name: "Lisa Torres",
    role: "Behavioral Analyst",
    initials: "LT",
    color: "#EC4899",
    voice: "stella",
    icon: <UserIcon size={12} weight="fill" />,
    description: "STAR-based behavioral assessment"
  }
];

const STAGES = [
  { agentId: "orchestrator", label: "Welcome" },
  { agentId: "recruiter", label: "HR Screen" },
  { agentId: "technical", label: "Technical" },
  { agentId: "culture", label: "Culture Fit" },
  { agentId: "domain", label: "Domain" },
  { agentId: "behavioral", label: "Behavioral" },
  { agentId: "orchestrator", label: "Closing" }
];

const TOOLS_REQUIRING_CONFIRMATION = ["getWeatherInformation"];

function agentById(id: string) {
  return AGENTS.find((a) => a.id === id) ?? AGENTS[0];
}

function fmtTime(d: Date) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PanelInterview() {
  const [theme, setTheme] = useState<"dark" | "light">(
    () => (localStorage.getItem("theme") as "dark" | "light") || "dark"
  );
  const [stageIndex, setStageIndex] = useState(0);
  const [agentStatuses, setAgentStatuses] = useState<
    Record<string, AgentStatus>
  >({
    orchestrator: "moderating",
    recruiter: "waiting",
    technical: "waiting",
    culture: "waiting",
    domain: "waiting",
    behavioral: "waiting"
  });
  const [isRecording, setRecording] = useState(false);
  const [isTranscribing, setTranscribing] = useState(false);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.toggle("light", theme !== "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const agent = useAgent({ agent: "chat", name: "candidate" });
  const { messages, addToolResult, clearHistory, status, sendMessage, stop } =
    useAgentChat<unknown, UIMessage<{ createdAt: string }>>({ agent });

  const currentAgent = agentById(STAGES[stageIndex].agentId);
  const isLastStage = stageIndex === STAGES.length - 1;
  const progressPct = Math.round((stageIndex / (STAGES.length - 1)) * 100);

  const advanceStage = useCallback(() => {
    setStageIndex((prev) => {
      const next = Math.min(prev + 1, STAGES.length - 1);
      setAgentStatuses((s) => {
        const u = { ...s };
        const prevAgent = STAGES[prev].agentId;
        const nextAgent = STAGES[next].agentId;
        if (prevAgent !== "orchestrator") u[prevAgent] = "done";
        u.orchestrator = "moderating";
        if (nextAgent !== "orchestrator") u[nextAgent] = "active";
        return u;
      });
      return next;
    });
  }, []);

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
          stream.getTracks().forEach((t) => t.stop());
        }
      };
      rec.start();
      setRecording(true);
    } catch (err) {
      console.error("Mic error:", err);
    }
  };

  const lastSpoken = useRef<string | null>(null);
  const speakResponse = useCallback(async (text: string, voice: string) => {
    const clean = text.replace(/\[MEMORY:[^\]]+\]/g, "").trim();
    if (!clean) return;
    try {
      const res = await fetch("/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean, voice })
      });
      if (res.ok) {
        const blob = await res.blob();
        new Audio(URL.createObjectURL(blob)).play();
      }
    } catch (err) {
      console.error("TTS error:", err);
    }
  }, []);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last?.role === "assistant" && status === "ready") {
      const textPart = last.parts?.find((p) => p.type === "text");
      if (
        textPart &&
        "text" in textPart &&
        textPart.text !== lastSpoken.current
      ) {
        lastSpoken.current = textPart.text;
        speakResponse(textPart.text, currentAgent.voice);
      }
    }
  }, [messages, status, speakResponse, currentAgent.voice]);

  useEffect(() => {
    if (messages.length > 0) scrollToBottom();
  }, [messages, scrollToBottom]);

  const pendingConfirmation = messages.some((m: UIMessage) =>
    m.parts?.some(
      (p) =>
        isStaticToolUIPart(p) &&
        p.state === "input-available" &&
        TOOLS_REQUIRING_CONFIRMATION.includes(p.type.replace("tool-", ""))
    )
  );

  function getMsgAgent(msgIdx: number) {
    if (messages.length === 0) return AGENTS[0];
    const si = Math.min(
      Math.floor((msgIdx / messages.length) * (STAGES.length - 1)),
      STAGES.length - 1
    );
    return agentById(STAGES[si].agentId);
  }

  // inline style helpers
  const S = {
    root: {
      display: "grid",
      gridTemplateRows: "auto 1fr",
      height: "100vh",
      overflow: "hidden",
      position: "relative" as const
    } as React.CSSProperties,
    body: {
      display: "grid",
      gridTemplateColumns: "256px 1fr",
      overflow: "hidden",
      height: "100%"
    } as React.CSSProperties,
    sidebar: {
      display: "flex",
      flexDirection: "column" as const,
      overflow: "hidden",
      borderRight: "1px solid rgba(148,163,184,0.1)"
    } as React.CSSProperties,
    main: {
      display: "flex",
      flexDirection: "column" as const,
      overflow: "hidden"
    } as React.CSSProperties
  };

  return (
    <div className="panel-root" style={S.root}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header
        className="panel-surface panel-header"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          padding: "0.625rem 1.5rem",
          borderBottom: "1px solid rgba(148,163,184,0.12)",
          zIndex: 10
        }}
      >
        {/* Brand */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexShrink: 0
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#10B981",
              boxShadow: "0 0 8px #10B98188",
              animation: "glow-pulse 2s ease-in-out infinite"
            }}
          />
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: "#e7edf8"
            }}
          >
            PanelAI
          </span>
          <span style={{ fontSize: 11, color: "#475569" }}>
            · Live Interview
          </span>
        </div>

        {/* Progress bar */}
        <div style={{ flex: 1, maxWidth: 400, margin: "0 auto" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 3
            }}
          >
            <span style={{ fontSize: 11, color: "#94a3b8" }}>
              {STAGES[stageIndex].label}
            </span>
            <span style={{ fontSize: 11, color: "#475569" }}>
              {stageIndex + 1} / {STAGES.length}
            </span>
          </div>
          <div
            style={{
              height: 3,
              borderRadius: 99,
              background: "rgba(255,255,255,0.06)",
              overflow: "hidden"
            }}
          >
            <div
              style={{
                height: "100%",
                borderRadius: 99,
                width: `${progressPct}%`,
                background: `linear-gradient(90deg, ${currentAgent.color}88, ${currentAgent.color})`,
                transition: "width 0.7s ease, background 0.5s ease"
              }}
            />
          </div>
        </div>

        {/* Controls */}
        <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
          {[
            {
              icon:
                theme === "dark" ? (
                  <SunIcon size={15} />
                ) : (
                  <MoonIcon size={15} />
                ),
              action: () => setTheme((t) => (t === "dark" ? "light" : "dark"))
            },
            { icon: <TrashIcon size={15} />, action: clearHistory }
          ].map((btn, i) => (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: static
              key={i}
              type="button"
              onClick={btn.action}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "0.375rem",
                borderRadius: 6,
                color: "#64748b",
                display: "flex",
                alignItems: "center"
              }}
            >
              {btn.icon}
            </button>
          ))}
        </div>
      </header>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div style={S.body}>
        {/* ── Sidebar ─────────────────────────────────────────────────── */}
        <aside className="panel-sidebar" style={S.sidebar}>
          <div
            style={{
              padding: "0.625rem 1rem",
              borderBottom: "1px solid rgba(148,163,184,0.08)"
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.12em",
                color: "#475569",
                textTransform: "uppercase"
              }}
            >
              Interview Panel
            </span>
          </div>

          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "0.75rem",
              display: "flex",
              flexDirection: "column",
              gap: 8
            }}
          >
            {AGENTS.map((a) => {
              const st = agentStatuses[a.id];
              const isActive = st === "active" || st === "moderating";
              const isDone = st === "done";
              return (
                <div
                  key={a.id}
                  style={{
                    borderRadius: 10,
                    padding: "0.625rem",
                    border: `1px solid ${isActive ? `${a.color}33` : isDone ? "rgba(16,185,129,0.18)" : "rgba(148,163,184,0.08)"}`,
                    background: isActive
                      ? `linear-gradient(135deg,${a.color}10,${a.color}05)`
                      : isDone
                        ? "rgba(16,185,129,0.04)"
                        : "rgba(255,255,255,0.02)",
                    boxShadow: isActive ? `0 0 18px ${a.color}18` : "none",
                    opacity: isDone ? 0.65 : 1,
                    transition: "all 0.4s ease"
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 11,
                        fontWeight: 800,
                        color: "#fff",
                        background: isActive
                          ? `linear-gradient(135deg,${a.color},${a.color}bb)`
                          : isDone
                            ? "rgba(16,185,129,0.25)"
                            : "rgba(255,255,255,0.07)",
                        boxShadow: isActive ? `0 0 12px ${a.color}44` : "none",
                        transition: "all 0.4s ease"
                      }}
                    >
                      {isDone ? (
                        <CheckCircleIcon
                          size={15}
                          weight="fill"
                          style={{ color: "#10B981" }}
                        />
                      ) : (
                        a.initials
                      )}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: isActive ? "#e7edf8" : "#64748b",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis"
                        }}
                      >
                        {a.name}
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          color: "#334155",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis"
                        }}
                      >
                        {a.role}
                      </div>
                    </div>

                    <div style={{ flexShrink: 0 }}>
                      {isActive && (
                        <div
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: "50%",
                            background: a.color,
                            boxShadow: `0 0 6px ${a.color}`,
                            animation: "glow-pulse 1.5s ease-in-out infinite"
                          }}
                        />
                      )}
                      {st === "done" && (
                        <CheckCircleIcon
                          size={13}
                          weight="fill"
                          style={{ color: "#10B981" }}
                        />
                      )}
                      {st === "waiting" && (
                        <ClockIcon size={13} style={{ color: "#1e293b" }} />
                      )}
                    </div>
                  </div>

                  {isActive && (
                    <div
                      style={{
                        marginTop: 8,
                        paddingTop: 8,
                        borderTop: "1px solid rgba(255,255,255,0.06)",
                        display: "flex",
                        alignItems: "center",
                        gap: 6
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          color: a.color,
                          fontWeight: 600
                        }}
                      >
                        {a.id === "orchestrator"
                          ? "Moderating"
                          : "Interviewing"}
                      </span>
                      {[0, 1, 2].map((i) => (
                        <div
                          key={i}
                          style={{
                            width: 4,
                            height: 4,
                            borderRadius: "50%",
                            background: a.color,
                            animation: `dot-bounce 1.2s ${i * 0.2}s ease-in-out infinite`
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {!isLastStage && (
            <div
              style={{
                padding: "0.75rem",
                borderTop: "1px solid rgba(148,163,184,0.08)"
              }}
            >
              <button
                type="button"
                onClick={advanceStage}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  padding: "0.5rem",
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  color: currentAgent.color,
                  background: `${currentAgent.color}12`,
                  border: `1px solid ${currentAgent.color}28`,
                  transition: "all 0.2s ease"
                }}
              >
                <CaretRightIcon size={13} />
                Next Stage
              </button>
            </div>
          )}
        </aside>

        {/* ── Main ──────────────────────────────────────────────────────── */}
        <main style={S.main}>
          {/* Active agent hero */}
          <div
            style={{
              padding: "0.875rem 1.5rem",
              flexShrink: 0,
              borderBottom: "1px solid rgba(148,163,184,0.1)",
              display: "flex",
              alignItems: "center",
              gap: "1rem",
              background: `linear-gradient(90deg, ${currentAgent.color}10 0%, transparent 55%)`
            }}
          >
            {/* Avatar */}
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 14,
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 16,
                fontWeight: 800,
                color: "#fff",
                background: `linear-gradient(135deg, ${currentAgent.color}, ${currentAgent.color}99)`,
                boxShadow: `0 0 28px ${currentAgent.color}44`,
                position: "relative"
              }}
            >
              {currentAgent.initials}
              <div
                style={{
                  position: "absolute",
                  bottom: -4,
                  right: -4,
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: currentAgent.color,
                  color: "#fff",
                  border: "2px solid rgba(7,13,24,0.9)"
                }}
              >
                {currentAgent.icon}
              </div>
            </div>

            <div style={{ flex: 1 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 2
                }}
              >
                <span
                  style={{ fontSize: 15, fontWeight: 700, color: "#e7edf8" }}
                >
                  {currentAgent.name}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 99,
                    letterSpacing: "0.06em",
                    color: currentAgent.color,
                    background: `${currentAgent.color}20`,
                    border: `1px solid ${currentAgent.color}30`
                  }}
                >
                  {STAGES[stageIndex].agentId === "orchestrator"
                    ? "MODERATOR"
                    : "ACTIVE"}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "#64748b" }}>
                {currentAgent.role}
              </div>
              <div style={{ fontSize: 11, color: "#334155", marginTop: 1 }}>
                {currentAgent.description}
              </div>
            </div>

            {/* Stage pills */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 4,
                maxWidth: 290,
                justifyContent: "flex-end"
              }}
            >
              {STAGES.map((s, i) => {
                const sa = agentById(s.agentId);
                return (
                  <span
                    key={`${s.agentId}-${i}`}
                    style={{
                      fontSize: 10,
                      padding: "2px 8px",
                      borderRadius: 99,
                      fontWeight: i === stageIndex ? 700 : 500,
                      background:
                        i === stageIndex
                          ? sa.color
                          : i < stageIndex
                            ? "rgba(255,255,255,0.07)"
                            : "rgba(255,255,255,0.03)",
                      color:
                        i === stageIndex
                          ? "#fff"
                          : i < stageIndex
                            ? "#475569"
                            : "#1e293b",
                      border: `1px solid ${i === stageIndex ? `${sa.color}55` : "transparent"}`,
                      transition: "all 0.3s ease"
                    }}
                  >
                    {s.label}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Transcript */}
          <div
            className="panel-chat-scroll"
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "1.25rem 1.5rem",
              display: "flex",
              flexDirection: "column",
              gap: "1rem"
            }}
          >
            {/* Empty state */}
            {messages.length === 0 && (
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  maxWidth: 400,
                  margin: "2rem auto 0"
                }}
              >
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 18,
                    fontSize: 20,
                    fontWeight: 800,
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 18,
                    background: `linear-gradient(135deg,${currentAgent.color},${currentAgent.color}88)`,
                    boxShadow: `0 0 48px ${currentAgent.color}44`
                  }}
                >
                  {currentAgent.initials}
                </div>
                <h3
                  style={{
                    fontSize: 17,
                    fontWeight: 700,
                    color: "#e7edf8",
                    margin: "0 0 8px"
                  }}
                >
                  Welcome to your Panel Interview
                </h3>
                <p
                  style={{
                    fontSize: 13,
                    color: "#475569",
                    lineHeight: 1.65,
                    marginBottom: 18
                  }}
                >
                  You'll be speaking with a panel of{" "}
                  <strong style={{ color: "#94a3b8" }}>5 specialists</strong>,
                  moderated by{" "}
                  <strong style={{ color: "#8B5CF6" }}>Alex Monroe</strong>.
                </p>
                <div
                  style={{
                    width: "100%",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6
                  }}
                >
                  {AGENTS.slice(1).map((a) => (
                    <div
                      key={a.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "0.5rem 0.75rem",
                        borderRadius: 8,
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(148,163,184,0.08)"
                      }}
                    >
                      <div
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 6,
                          flexShrink: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 9,
                          fontWeight: 800,
                          color: "#fff",
                          background: a.color
                        }}
                      >
                        {a.initials}
                      </div>
                      <div style={{ textAlign: "left" }}>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: "#94a3b8"
                          }}
                        >
                          {a.name}
                        </div>
                        <div style={{ fontSize: 10, color: "#475569" }}>
                          {a.role}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: 11, color: "#1e293b", marginTop: 18 }}>
                  Send a message to begin your interview.
                </p>
              </div>
            )}

            {/* Messages */}
            {messages.map((m, idx) => {
              const isUser = m.role === "user";
              const ma = isUser ? null : getMsgAgent(idx);
              const showHeader =
                !isUser && (idx === 0 || messages[idx - 1]?.role === "user");

              return (
                <div key={m.id} className="panel-animate-in">
                  {!isUser && showHeader && ma && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 6
                      }}
                    >
                      <div
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 5,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 9,
                          fontWeight: 800,
                          color: "#fff",
                          background: ma.color,
                          flexShrink: 0
                        }}
                      >
                        {ma.initials}
                      </div>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: ma.color
                        }}
                      >
                        {ma.name}
                      </span>
                      <span style={{ fontSize: 10, color: "#334155" }}>
                        {ma.role}
                      </span>
                    </div>
                  )}

                  <div
                    style={{
                      display: "flex",
                      justifyContent: isUser ? "flex-end" : "flex-start"
                    }}
                  >
                    <div style={{ maxWidth: "78%" }}>
                      {m.parts?.map((part, i) => {
                        if (part.type === "text") {
                          const clean = part.text
                            .replace(/\[MEMORY:[^\]]+\]/g, "")
                            .replace(
                              /.*\{"type":\s*"function"[^}]*"parameters":\s*\{[^}]*\}\}.*/g,
                              ""
                            )
                            .trim();
                          if (!clean) return null;
                          return (
                            // biome-ignore lint/suspicious/noArrayIndexKey: immutable
                            <div key={i}>
                              <div
                                className={
                                  isUser
                                    ? "panel-bubble-user"
                                    : "panel-bubble-agent"
                                }
                                style={{
                                  padding: "0.625rem 0.875rem",
                                  fontSize: 13,
                                  lineHeight: 1.65,
                                  borderRadius: isUser
                                    ? "12px 12px 3px 12px"
                                    : "3px 12px 12px 12px",
                                  borderLeft:
                                    !isUser && ma
                                      ? `3px solid ${ma.color}`
                                      : undefined
                                }}
                              >
                                <MemoizedMarkdown
                                  id={`${m.id}-${i}`}
                                  content={clean.replace(
                                    /^scheduled message: /,
                                    ""
                                  )}
                                />
                              </div>
                              <div
                                style={{
                                  fontSize: 10,
                                  color: "#1e293b",
                                  marginTop: 3,
                                  textAlign: isUser ? "right" : "left"
                                }}
                              >
                                {fmtTime(
                                  m.metadata?.createdAt
                                    ? new Date(m.metadata.createdAt)
                                    : new Date()
                                )}
                              </div>
                            </div>
                          );
                        }

                        if (
                          isStaticToolUIPart(part) &&
                          m.role === "assistant"
                        ) {
                          const toolName = part.type.replace("tool-", "");
                          return (
                            <ToolInvocationCard
                              // biome-ignore lint/suspicious/noArrayIndexKey: safe
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
            {(status === "submitted" || status === "streaming") && (
              <div
                className="panel-animate-in"
                style={{ display: "flex", alignItems: "center", gap: 10 }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 7,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    fontWeight: 800,
                    color: "#fff",
                    background: `linear-gradient(135deg,${currentAgent.color},${currentAgent.color}99)`,
                    boxShadow: `0 0 10px ${currentAgent.color}44`
                  }}
                >
                  {currentAgent.initials}
                </div>
                <div
                  className="panel-bubble-agent"
                  style={{
                    padding: "0.5rem 0.875rem",
                    borderRadius: "3px 12px 12px 12px",
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
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: currentAgent.color,
                        animation: `dot-bounce 1.2s ${i * 0.2}s ease-in-out infinite`
                      }}
                    />
                  ))}
                </div>
                <span style={{ fontSize: 11, color: "#334155" }}>
                  {currentAgent.name} is typing…
                </span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div
            style={{
              padding: "0.875rem 1.5rem",
              borderTop: "1px solid rgba(148,163,184,0.1)",
              flexShrink: 0
            }}
          >
            <form onSubmit={handleSubmit}>
              <div
                className="panel-input-shell"
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  gap: 10,
                  padding: "0.625rem 0.75rem",
                  borderRadius: 14,
                  borderColor: `${currentAgent.color}25`
                }}
              >
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#64748b",
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(148,163,184,0.12)",
                    marginBottom: 1
                  }}
                >
                  C
                </div>

                <textarea
                  disabled={pendingConfirmation || isTranscribing}
                  placeholder={
                    pendingConfirmation
                      ? "Please respond to the confirmation above…"
                      : isTranscribing
                        ? "Transcribing…"
                        : "Your response…"
                  }
                  value={input}
                  rows={1}
                  onChange={(e) => {
                    setInput(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
                  }}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      handleSubmit(e as unknown as React.FormEvent);
                    }
                  }}
                  style={{
                    flex: 1,
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    resize: "none",
                    fontSize: 13,
                    color: "#dbeafe",
                    lineHeight: 1.5,
                    minHeight: 20,
                    maxHeight: 160,
                    overflowY: "auto",
                    fontFamily: "inherit",
                    padding: 0
                  }}
                />

                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={handleVoiceInput}
                    disabled={isTranscribing}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "0.375rem",
                      borderRadius: 8,
                      cursor: "pointer",
                      background: isRecording
                        ? currentAgent.color
                        : "rgba(255,255,255,0.06)",
                      border: `1px solid ${isRecording ? currentAgent.color : "rgba(148,163,184,0.15)"}`,
                      color: isRecording ? "#fff" : "#64748b",
                      animation: isRecording
                        ? "glow-pulse 1s ease-in-out infinite"
                        : "none"
                    }}
                  >
                    <MicrophoneIcon size={15} />
                  </button>

                  {status === "submitted" || status === "streaming" ? (
                    <button
                      type="button"
                      onClick={stop}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        padding: "0.375rem",
                        borderRadius: 8,
                        cursor: "pointer",
                        background: "rgba(239,68,68,0.12)",
                        border: "1px solid rgba(239,68,68,0.25)",
                        color: "#f87171"
                      }}
                    >
                      <StopIcon size={15} />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={pendingConfirmation || !input.trim()}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        padding: "0.375rem",
                        borderRadius: 8,
                        cursor: input.trim() ? "pointer" : "default",
                        background: input.trim()
                          ? currentAgent.color
                          : "rgba(255,255,255,0.05)",
                        border: `1px solid ${input.trim() ? `${currentAgent.color}55` : "rgba(148,163,184,0.1)"}`,
                        color: input.trim() ? "#fff" : "#1e293b",
                        opacity: !input.trim() || pendingConfirmation ? 0.4 : 1,
                        transition: "all 0.2s ease"
                      }}
                    >
                      <PaperPlaneTiltIcon size={15} />
                    </button>
                  )}
                </div>
              </div>

              <p
                style={{
                  fontSize: 10,
                  color: "#1e293b",
                  textAlign: "center",
                  marginTop: 5
                }}
              >
                Responses are recorded for evaluation · Enter to send ·
                Shift+Enter for new line
              </p>
            </form>
          </div>
        </main>
      </div>

      {/* Keyframe animations */}
      <style>{`
        @keyframes glow-pulse { 0%,100%{opacity:0.7} 50%{opacity:1} }
        @keyframes dot-bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-5px)} }
      `}</style>
    </div>
  );
}
