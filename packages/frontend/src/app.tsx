/** biome-ignore-all lint/correctness/useUniqueElementIds: it's alright */
import { useEffect, useState, useRef, useCallback, use } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import type { UIMessage } from "@ai-sdk/react";

import { Button } from "@/components/button/Button";
import { Card } from "@/components/card/Card";
import { Toggle } from "@/components/toggle/Toggle";

import {
  BugIcon,
  TrashIcon,
  UserIcon,
  BrainIcon,
  UsersThreeIcon,
  GlobeIcon,
  ShieldCheckIcon,
  PulseIcon,
  MicrophoneIcon
} from "@phosphor-icons/react";

type InterviewPhase =
  | "idle"
  | "screening"
  | "interviewing"
  | "deliberation"
  | "decision"
  | "complete";

type CandidateWorkspaceMode = "none" | "whiteboard" | "code";

interface AgentPanel {
  id: string;
  name: string;
  role: string;
  icon: React.ReactNode;
  accentColor: string;
  borderGlow: string;
  status: "idle" | "active" | "complete" | "error";
  score?: number;
  recommendation?: string;
  output?: string;
  feed: string[];
  cameraLabel?: string;
  seat?: "far-left" | "left" | "center-right" | "far-right" | "command";
}

type Scorecard = {
  status?: string;
  synthesizedRecommendation?: string;
  humanDecision?: {
    decision: "hire" | "reject" | "follow-up";
    decidedBy: string;
    decidedAt: string;
    notes?: string;
  };
} | null;

const INITIAL_PANELS: AgentPanel[] = [
  {
    id: "recruiter",
    name: "Recruiter",
    role: "Resume Screening & Scoring",
    icon: <UserIcon size={20} weight="bold" />,
    accentColor: "emerald",
    borderGlow: "rgba(52,211,153,0.42)",
    status: "idle",
    feed: ["Standing by for candidate packet."],
    cameraLabel: "Screen A1",
    seat: "far-left"
  },
  {
    id: "technical",
    name: "Technical",
    role: "Systems & Architecture",
    icon: <BrainIcon size={20} weight="bold" />,
    accentColor: "sky",
    borderGlow: "rgba(56,189,248,0.42)",
    status: "idle",
    feed: ["Awaiting recruiter handoff."],
    cameraLabel: "Screen A2",
    seat: "left"
  },
  {
    id: "culture",
    name: "Culture",
    role: "Behavioral & Values Fit",
    icon: <UsersThreeIcon size={20} weight="bold" />,
    accentColor: "amber",
    borderGlow: "rgba(251,191,36,0.38)",
    status: "idle",
    feed: ["Waiting for panel activation."],
    cameraLabel: "Screen A3",
    seat: "center-right"
  },
  {
    id: "domain",
    name: "Domain Expert",
    role: "Industry Knowledge",
    icon: <GlobeIcon size={20} weight="bold" />,
    accentColor: "violet",
    borderGlow: "rgba(167,139,250,0.38)",
    status: "idle",
    feed: ["Idle until interview phase starts."],
    cameraLabel: "Screen A4",
    seat: "far-right"
  },
  {
    id: "orchestrator",
    name: "Orchestrator",
    role: "Flow Control & Synthesis",
    icon: <ShieldCheckIcon size={20} weight="bold" />,
    accentColor: "cyan",
    borderGlow: "rgba(34,211,238,0.44)",
    status: "idle",
    feed: ["Mission control online."],
    cameraLabel: "Command",
    seat: "command"
  }
];

function statusDotClass(status: AgentPanel["status"]) {
  switch (status) {
    case "active":
      return "bg-cyan-400 animate-pulse";
    case "complete":
      return "bg-emerald-400";
    case "error":
      return "bg-red-400";
    default:
      return "bg-slate-500";
  }
}

function activeCircleTone(isActive: boolean) {
  if (isActive) {
    return "border-emerald-400/80 bg-emerald-950/25 ring-1 ring-emerald-400/35";
  }
  return "border-cyan-500/45 bg-slate-900/70";
}

function AgentTile({ panel }: { panel?: AgentPanel }) {
  if (!panel) return null;

  const statusTone =
    panel.status === "active"
      ? "border-cyan-400/50 ring-1 ring-cyan-400/30"
      : panel.status === "complete"
        ? "border-emerald-400/40"
        : panel.status === "error"
          ? "border-red-400/40"
          : "border-slate-700/70";

  return (
    <div
      className={`relative flex min-h-[220px] flex-col overflow-hidden rounded-2xl border bg-slate-900/80 ${statusTone}`}
    >
      <div className="absolute inset-0 bg-gradient-to-b from-slate-800/30 to-slate-950/40" />

      <div className="relative flex items-center justify-between border-b border-slate-700/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <div
            className={`h-2.5 w-2.5 rounded-full ${statusDotClass(panel.status)}`}
          />
          <span className="text-sm font-semibold text-slate-100">
            {panel.name}
          </span>
        </div>
        <span className="text-[11px] uppercase tracking-wide text-slate-400">
          {panel.role}
        </span>
      </div>

      <div className="relative flex flex-1 flex-col justify-between p-4">
        <div className="rounded-xl border border-slate-700/50 bg-slate-950/40 p-4">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800 text-cyan-200">
              {panel.icon}
            </div>
            <div>
              <p className="text-sm font-medium text-slate-100">{panel.name}</p>
              <p className="text-xs text-slate-400">
                {panel.status === "active" ? "Speaking..." : "Listening"}
              </p>
            </div>
          </div>

          <p className="text-sm text-slate-300">
            {panel.output ?? "Awaiting panel activation."}
          </p>
          {panel.score !== undefined && (
            <div className="mt-3 inline-flex items-center gap-1 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-[11px] font-medium text-cyan-200">
              <PulseIcon size={12} />
              {panel.score.toFixed(1)}
            </div>
          )}
        </div>

        <div className="mt-4 space-y-2">
          {panel.feed.slice(0, 2).map((line) => (
            <div
              key={`${panel.id}-${line}`}
              className="rounded-lg bg-slate-800/60 px-3 py-2 text-xs text-slate-400"
            >
              {line}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CommandTile({
  interviewPhase,
  phase2Loading,
  runInterviewDrill,
  synthesizeRecommendation,
  dashboardScorecard,
  submitHumanDecision,
  decisionLoading,
  orchestrator,
  managerDecisionNotes,
  setManagerDecisionNotes
}: {
  interviewPhase: InterviewPhase;
  phase2Loading: boolean;
  runInterviewDrill: () => Promise<void>;
  synthesizeRecommendation: () => Promise<void>;
  dashboardScorecard: Scorecard;
  submitHumanDecision: (
    decision: "hire" | "reject" | "follow-up"
  ) => Promise<void>;
  decisionLoading: boolean;
  orchestrator?: AgentPanel;
  managerDecisionNotes: string;
  setManagerDecisionNotes: React.Dispatch<React.SetStateAction<string>>;
}) {
  return (
    <div className="flex h-full min-h-[460px] flex-col rounded-2xl border border-slate-700/70 bg-slate-900/85">
      <div className="border-b border-slate-700/60 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-100">Panel Control</h2>
        <p className="text-xs text-slate-400">
          Review candidate files, add notes, then make the final decision.
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-4">
        <div className="rounded-xl border border-slate-700/60 bg-slate-800/60 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            Candidate files
          </p>
          <div className="mt-2 space-y-1 text-xs text-slate-300">
            <p>candidates/</p>
            <p className="pl-3 text-slate-400">alex-candidate/</p>
            <p className="pl-6 text-cyan-200">profile.md</p>
            <p className="pl-6 text-cyan-200">panel-notes.md</p>
            <p className="pl-6 text-cyan-200">decision.md</p>
          </div>
        </div>

        <div className="rounded-xl bg-slate-800/60 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            Current phase
          </p>
          <p className="mt-1 text-lg text-cyan-200">{interviewPhase}</p>
        </div>

        <button
          type="button"
          onClick={runInterviewDrill}
          disabled={phase2Loading || interviewPhase !== "idle"}
          className="rounded-xl border border-cyan-500/40 bg-cyan-500/15 px-4 py-3 text-sm font-medium text-cyan-200 disabled:opacity-40"
        >
          {phase2Loading ? "Running interview..." : "Start interview"}
        </button>

        <button
          type="button"
          onClick={synthesizeRecommendation}
          disabled={phase2Loading || interviewPhase !== "interviewing"}
          className="rounded-xl border border-cyan-500/35 bg-slate-800/70 px-4 py-2.5 text-sm font-medium text-cyan-200 disabled:opacity-40"
        >
          Finalize recommendation
        </button>

        <div className="rounded-xl bg-slate-800/60 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            Orchestrator
          </p>
          <p className="mt-2 text-sm text-slate-200">
            {orchestrator?.output ?? "Mission control online."}
          </p>
        </div>

        {dashboardScorecard?.synthesizedRecommendation && (
          <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-4">
            <p className="text-xs uppercase tracking-wide text-cyan-300/70">
              Recommendation
            </p>
            <p className="mt-2 text-sm font-medium text-cyan-200">
              {dashboardScorecard.synthesizedRecommendation}
            </p>
          </div>
        )}

        <div className="rounded-xl border border-slate-700/60 bg-slate-800/60 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            Manager decision notes
          </p>
          <textarea
            value={managerDecisionNotes}
            onChange={(event) => setManagerDecisionNotes(event.target.value)}
            placeholder="Write why you are making this decision..."
            className="mt-2 h-24 w-full resize-none rounded-lg border border-slate-700 bg-slate-900/70 p-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-500/50"
          />
        </div>

        <div className="mt-auto grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => void submitHumanDecision("hire")}
            disabled={
              decisionLoading ||
              interviewPhase !== "decision" ||
              !managerDecisionNotes.trim()
            }
            className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 py-2 text-xs font-semibold text-emerald-300"
          >
            Hire
          </button>
          <button
            type="button"
            onClick={() => void submitHumanDecision("follow-up")}
            disabled={
              decisionLoading ||
              interviewPhase !== "decision" ||
              !managerDecisionNotes.trim()
            }
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 py-2 text-xs font-semibold text-amber-300"
          >
            Follow-up
          </button>
          <button
            type="button"
            onClick={() => void submitHumanDecision("reject")}
            disabled={
              decisionLoading ||
              interviewPhase !== "decision" ||
              !managerDecisionNotes.trim()
            }
            className="rounded-lg border border-red-500/30 bg-red-500/10 py-2 text-xs font-semibold text-red-300"
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}

function ManagerWarRoom({
  showDebug,
  setShowDebug,
  switchView,
  clearHistory,
  setPanels,
  setInterviewPhase,
  setDashboardScorecard,
  runInterviewDrill,
  synthesizeRecommendation,
  phase2Loading,
  interviewPhase,
  dashboardScorecard,
  submitHumanDecision,
  decisionLoading,
  panelById,
  managerDecisionNotes,
  setManagerDecisionNotes,
  setWorkspaceMode,
  setWorkspacePrompt
}: {
  showDebug: boolean;
  setShowDebug: React.Dispatch<React.SetStateAction<boolean>>;
  switchView: (mode: "candidate" | "manager") => void;
  clearHistory: () => void;
  setPanels: React.Dispatch<React.SetStateAction<AgentPanel[]>>;
  setInterviewPhase: React.Dispatch<React.SetStateAction<InterviewPhase>>;
  setDashboardScorecard: React.Dispatch<React.SetStateAction<Scorecard>>;
  runInterviewDrill: () => Promise<void>;
  synthesizeRecommendation: () => Promise<void>;
  phase2Loading: boolean;
  interviewPhase: InterviewPhase;
  dashboardScorecard: Scorecard;
  submitHumanDecision: (
    decision: "hire" | "reject" | "follow-up"
  ) => Promise<void>;
  decisionLoading: boolean;
  panelById: (id: string) => AgentPanel | undefined;
  managerDecisionNotes: string;
  setManagerDecisionNotes: React.Dispatch<React.SetStateAction<string>>;
  setWorkspaceMode: React.Dispatch<
    React.SetStateAction<CandidateWorkspaceMode>
  >;
  setWorkspacePrompt: React.Dispatch<React.SetStateAction<string>>;
}) {
  const recruiter = panelById("recruiter");
  const technical = panelById("technical");
  const culture = panelById("culture");
  const domain = panelById("domain");
  const orchestrator = panelById("orchestrator");

  return (
    <div className="relative flex h-full flex-col gap-4 p-4">
      <header className="flex shrink-0 items-center justify-between rounded-2xl border border-slate-700/60 bg-slate-900/80 px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800 text-cyan-300">
            <ShieldCheckIcon size={18} className="text-cyan-300" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-100">
              PanelAI War Room
            </h1>
            <p className="text-sm text-slate-400">
              Hiring Manager Command Center
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <BugIcon size={14} className="text-slate-500" />
            <Toggle
              toggled={showDebug}
              aria-label="Toggle debug mode"
              onClick={() => setShowDebug((prev) => !prev)}
            />
          </div>

          <Button
            size="sm"
            className="bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25"
            onClick={() => switchView("candidate")}
          >
            Candidate View
          </Button>

          <Button
            variant="ghost"
            size="sm"
            shape="square"
            className="h-8 w-8 rounded-lg"
            onClick={() => {
              clearHistory();
              setPanels(INITIAL_PANELS);
              setInterviewPhase("idle");
              setDashboardScorecard(null);
              setManagerDecisionNotes("");
              setWorkspaceMode("none");
              setWorkspacePrompt("Workspace inactive.");
            }}
          >
            <TrashIcon size={14} className="text-slate-400" />
          </Button>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-12">
        <section className="grid min-h-0 grid-cols-1 gap-4 md:grid-cols-2 xl:col-span-8">
          <AgentTile panel={recruiter} />
          <AgentTile panel={technical} />
          <AgentTile panel={culture} />
          <AgentTile panel={domain} />
        </section>
        <aside className="min-h-0 xl:col-span-4">
          <CommandTile
            interviewPhase={interviewPhase}
            phase2Loading={phase2Loading}
            runInterviewDrill={runInterviewDrill}
            synthesizeRecommendation={synthesizeRecommendation}
            dashboardScorecard={dashboardScorecard}
            submitHumanDecision={submitHumanDecision}
            decisionLoading={decisionLoading}
            orchestrator={orchestrator}
            managerDecisionNotes={managerDecisionNotes}
            setManagerDecisionNotes={setManagerDecisionNotes}
          />
        </aside>
      </main>

      <footer className="flex shrink-0 items-center justify-between rounded-2xl border border-slate-700/60 bg-slate-900/80 px-4 py-3">
        <div className="text-xs text-slate-400">
          Meeting layout: 4 agent tiles + command column
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="rounded-lg border border-slate-700/60 bg-slate-800/60 px-2 py-1 text-slate-300">
            Phase: {interviewPhase}
          </span>
          <span className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-cyan-200">
            Orchestrator: {orchestrator?.status ?? "idle"}
          </span>
        </div>
      </footer>
    </div>
  );
}

export default function Chat() {
  const [showDebug, setShowDebug] = useState(false);

  const [panels, setPanels] = useState<AgentPanel[]>(INITIAL_PANELS);
  const [interviewPhase, setInterviewPhase] = useState<InterviewPhase>("idle");
  const [phase2Loading, setPhase2Loading] = useState(false);
  const [decisionLoading, setDecisionLoading] = useState(false);
  const demoInterviewId = "iv-demo-1";
  const demoCandidateId = "candidate-demo-1";

  const [dashboardScorecard, setDashboardScorecard] = useState<Scorecard>(null);
  const [managerDecisionNotes, setManagerDecisionNotes] = useState("");
  const [workspaceMode, setWorkspaceMode] =
    useState<CandidateWorkspaceMode>("none");
  const [workspacePrompt, setWorkspacePrompt] = useState("Workspace inactive.");
  const [isRecording, setRecording] = useState(false);
  const [isTranscribing, setTranscribing] = useState(false);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const [viewMode, setViewMode] = useState<"candidate" | "manager">(() => {
    if (typeof window === "undefined") return "candidate";
    return "candidate";
  });

  const switchView = (mode: "candidate" | "manager") => {
    setViewMode(mode);
    if (typeof window === "undefined") return;
    const nextPath = mode === "manager" ? "/manager" : "/candidate";
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, "", nextPath);
    }
  };

  useEffect(() => {
    document.documentElement.classList.add("dark");
    document.documentElement.classList.remove("light");
    localStorage.setItem("theme", "dark");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPopState = () => {
      setViewMode("candidate");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const agent = useAgent({ agent: "chat", name: "candidate-session" });

  const {
    messages: agentMessages,
    clearHistory,
    status,
    sendMessage
  } = useAgentChat<unknown, UIMessage<{ createdAt: string }>>({ agent });

  const speakResponse = useCallback(async (text: string) => {
    try {
      const cleanText = text
        .replace(/\[MEMORY:[^\]]+\]/g, "")
        .replace(
          /.*\{"type":\s*"function"[^}]*"parameters":\s*\{[^}]*\}\}.*/g,
          ""
        )
        .trim();

      if (!cleanText) return;

      const response = await fetch("/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: cleanText })
      });

      if (response.ok) {
        const blob = await response.blob();
        const audio = new Audio(URL.createObjectURL(blob));
        void audio.play();
      }
    } catch (error) {
      console.error("TTS Error: ", error);
    }
  }, []);

  const handleVoiceInput = useCallback(async () => {
    if (isRecording) {
      mediaRecorder.current?.stop();
      setRecording(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorder.current = recorder;
      audioChunks.current = [];

      recorder.ondataavailable = (event) => {
        audioChunks.current.push(event.data);
      };

      recorder.onstop = async () => {
        setTranscribing(true);
        const blob = new Blob(audioChunks.current, { type: "audio/webm" });
        const formData = new FormData();
        formData.append("audio", blob);

        try {
          const response = await fetch("/transcribe", {
            method: "POST",
            body: formData
          });
          const data = (await response.json()) as { text?: string };
          if (data.text?.trim()) {
            await sendMessage({
              role: "user",
              parts: [{ type: "text", text: data.text }]
            });
          }
        } catch (error) {
          console.error("Transcription error:", error);
        } finally {
          setTranscribing(false);
          stream.getTracks().forEach((track) => {
            track.stop();
          });
        }
      };

      recorder.start();
      setRecording(true);
    } catch (error) {
      console.error("Microphone access error:", error);
    }
  }, [isRecording, sendMessage]);

  const lastSpoken = useRef<string | null>(null);
  const lastHandledHandoffText = useRef<string | null>(null);

  useEffect(() => {
    const lastMsg = agentMessages[agentMessages.length - 1];
    if (lastMsg?.role === "assistant" && status === "ready") {
      const textPart = lastMsg.parts?.find((p) => p.type === "text");
      if (
        textPart &&
        "text" in textPart &&
        textPart.text !== lastSpoken.current
      ) {
        lastSpoken.current = textPart.text;
        void speakResponse(textPart.text);
      }
    }
  }, [agentMessages, status, speakResponse]);

  const updatePanel = (id: string, updates: Partial<AgentPanel>) => {
    setPanels((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...updates } : p))
    );
  };

  const appendPanelFeed = (id: string, line: string) => {
    setPanels((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, feed: [line, ...p.feed].slice(0, 4) } : p
      )
    );
  };

  const setSingleSpeaker = useCallback(
    (speakerId: string, orchestratorOutput?: string) => {
      setPanels((prev) =>
        prev.map((panel) => {
          if (panel.id === speakerId) {
            return { ...panel, status: "active" };
          }
          if (panel.id === "orchestrator") {
            return {
              ...panel,
              status: speakerId === "orchestrator" ? "active" : "idle",
              output:
                orchestratorOutput ??
                (speakerId === "orchestrator"
                  ? panel.output
                  : "Moderator is guiding the process and supporting your progress.")
            };
          }
          return panel.status === "error"
            ? panel
            : { ...panel, status: "idle" };
        })
      );
    },
    []
  );

  useEffect(() => {
    const lastMsg = agentMessages[agentMessages.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant") return;
    const textPart = lastMsg.parts?.find((p) => p.type === "text");
    if (!textPart || !("text" in textPart)) return;
    const rawText = textPart.text.trim();
    if (!rawText || rawText === lastHandledHandoffText.current) return;
    lastHandledHandoffText.current = rawText;

    const text = rawText.toLowerCase();
    if (text.includes("hand") && text.includes("technical interviewer")) {
      setSingleSpeaker(
        "technical",
        "Handoff complete. Technical interviewer is now leading while I continue supporting you."
      );
      return;
    }
    if (text.includes("hand") && text.includes("culture interviewer")) {
      setSingleSpeaker(
        "culture",
        "Handoff complete. Culture interviewer is now leading while I continue guiding."
      );
      return;
    }
    if (
      text.includes("hand") &&
      (text.includes("domain expert") || text.includes("domain interviewer"))
    ) {
      setSingleSpeaker(
        "domain",
        "Handoff complete. Domain expert is now leading while I continue supporting."
      );
      return;
    }
    if (
      text.includes("hand") &&
      (text.includes("back to moderator") ||
        text.includes("back to orchestrator"))
    ) {
      setSingleSpeaker(
        "orchestrator",
        "I'm back as moderator to guide next steps and support your process."
      );
    }
  }, [agentMessages, setSingleSpeaker]);

  const runInterviewDrill = async () => {
    const sleep = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));
    setPhase2Loading(true);
    setInterviewPhase("screening");
    setPanels(INITIAL_PANELS);
    setDashboardScorecard(null);
    setManagerDecisionNotes("");
    setWorkspaceMode("none");
    setWorkspacePrompt("Workspace inactive.");

    try {
      updatePanel("recruiter", {
        status: "active",
        output: "Analyzing resume..."
      });
      setSingleSpeaker(
        "orchestrator",
        "Welcome to your interview. I'll guide the process, support you through each stage, and hand off to specialists one at a time."
      );
      appendPanelFeed(
        "orchestrator",
        "Welcome. We have other interviewers with us, and they'll introduce themselves when it's their turn."
      );
      appendPanelFeed("orchestrator", "Recruiter scoring initiated.");
      appendPanelFeed(
        "recruiter",
        "Parsing resume and normalizing candidate profile."
      );
      await sleep(1400);

      const now = new Date().toISOString();

      const scoringResponse = await fetch("/api/recruiter/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: demoCandidateId,
          resumeText:
            "Entry-level candidate with internships and project outcomes across dashboard and data tooling work.",
          profile: {
            name: "Alex Candidate",
            email: "alex@example.com",
            skills: ["TypeScript", "React", "SQL"],
            yearsExperience: 2,
            projects: ["Dashboard modernization", "Data pipeline optimization"],
            certifications: [],
            workAuthorization: "authorized"
          },
          job: {
            id: "job-demo-1",
            title: "Software Engineer",
            department: "Engineering",
            location: "Remote",
            remotePolicy: "remote",
            employmentType: "full-time",
            level: "entry",
            description: "Build product features end-to-end.",
            requiredSkills: ["TypeScript", "React", "Communication"],
            preferredSkills: ["AWS cert"],
            minYearsExperience: 3,
            hiringManager: "HM",
            recruiters: ["R1"],
            status: "open",
            createdAt: now,
            updatedAt: now
          }
        })
      });

      const scoringJson = (await scoringResponse.json()) as {
        data?: {
          artifact?: {
            weightedScore: number;
            recommendationBand: string;
            penalties: string[];
            hardKnockouts: string[];
            candidateCoachingSummary: {
              strengths: string[];
              growthAreas: string[];
              actionableNextSteps: string[];
              encouragingSummary: string;
            };
          };
        };
      };

      const artifact = scoringJson.data?.artifact;
      if (!artifact) throw new Error("No recruiter artifact returned.");

      updatePanel("recruiter", {
        status: "complete",
        score: artifact.weightedScore,
        recommendation: artifact.recommendationBand,
        output: `Score: ${artifact.weightedScore.toFixed(1)} | ${artifact.recommendationBand}`
      });
      appendPanelFeed(
        "recruiter",
        `Completed with ${artifact.recommendationBand} (${artifact.weightedScore.toFixed(1)}).`
      );
      await sleep(1200);

      setInterviewPhase("interviewing");
      const moderatorOpening =
        "Welcome to the interviewing stage. I'll guide each transition, and each specialist will take turns speaking with you.";
      setSingleSpeaker("orchestrator", moderatorOpening);
      appendPanelFeed(
        "orchestrator",
        "Interviewing stage started. Moderator speaking first."
      );
      await speakResponse(moderatorOpening);
      await sleep(500);

      await fetch("/api/orchestrator/advance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interviewId: demoInterviewId,
          recruiterArtifact: artifact
        })
      });

      setSingleSpeaker(
        "technical",
        "Moderator handoff complete. Technical interviewer is now leading this section while I continue supporting."
      );
      updatePanel("technical", {
        output:
          "Hi, I'm the Technical Interviewer. Let's begin with a coding task and your approach."
      });
      updatePanel("culture", {
        output:
          "Hi, I'm the Culture Interviewer. I'll focus on collaboration, ownership, and communication."
      });
      updatePanel("domain", {
        output:
          "Hi, I'm the Domain Expert. I'll ask scenario-based questions tied to product decisions."
      });
      appendPanelFeed(
        "technical",
        "Introduced role and opened coding section."
      );
      appendPanelFeed(
        "culture",
        "Introduced role and opened behavioral section."
      );
      appendPanelFeed("domain", "Introduced role and opened domain section.");
      await sleep(800);
      setSingleSpeaker(
        "culture",
        "Technical section complete. Culture interviewer is now leading while I continue to guide."
      );
      await sleep(800);
      setSingleSpeaker(
        "domain",
        "Culture section complete. Domain expert is now leading while I continue to support."
      );
      setWorkspaceMode("code");
      setWorkspacePrompt(
        "Coding prompt: Build a rate limiter API and explain complexity and trade-offs."
      );

      await fetch("/api/interview/run-panel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interviewId: demoInterviewId,
          candidateId: demoCandidateId
        })
      });

      updatePanel("technical", {
        status: "complete",
        output: "Evaluation complete"
      });
      updatePanel("culture", {
        status: "complete",
        output: "Assessment complete"
      });
      updatePanel("domain", { status: "complete", output: "Review complete" });
      appendPanelFeed("technical", "Submitted technical interview findings.");
      appendPanelFeed("culture", "Submitted culture/values findings.");
      appendPanelFeed("domain", "Submitted domain expertise findings.");
      setWorkspaceMode("whiteboard");
      setWorkspacePrompt(
        "System design prompt: Whiteboard a scalable notification pipeline and identify bottlenecks."
      );

      setSingleSpeaker(
        "orchestrator",
        "Panel questions are complete. Before we close, do you have any questions for the team?"
      );
      appendPanelFeed(
        "orchestrator",
        "Panel questions complete. Inviting candidate questions before closing."
      );
    } catch (error) {
      console.error("Interview drill error:", error);
      updatePanel("orchestrator", {
        status: "error",
        output: "Pipeline error."
      });
      appendPanelFeed("orchestrator", "Error: interview run interrupted.");
      setInterviewPhase("idle");
      setSingleSpeaker(
        "orchestrator",
        "I hit an issue while coordinating the interview flow."
      );
    } finally {
      setPhase2Loading(false);
    }
  };

  const synthesizeRecommendation = async () => {
    setPhase2Loading(true);
    try {
      setInterviewPhase("deliberation");
      appendPanelFeed(
        "orchestrator",
        "Synthesizing panel outputs into recommendation."
      );

      const dashboardResponse = await fetch(
        `/api/dashboard/interview?interviewId=${demoInterviewId}`
      );
      const dashboardJson = (await dashboardResponse.json()) as Scorecard;
      setDashboardScorecard(dashboardJson);

      setInterviewPhase("decision");
      updatePanel("orchestrator", {
        status: "complete",
        output: "Recommendation ready. Human decision required."
      });
      appendPanelFeed(
        "orchestrator",
        "Awaiting hiring manager final decision."
      );
    } finally {
      setPhase2Loading(false);
    }
  };

  const submitHumanDecision = async (
    decision: "hire" | "reject" | "follow-up"
  ) => {
    setDecisionLoading(true);

    try {
      await fetch("/api/human-decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interviewId: demoInterviewId,
          decision,
          decidedBy: "Hiring Manager",
          notes:
            managerDecisionNotes.trim() ||
            "Decision from war room command center."
        })
      });

      const dashboardResponse = await fetch(
        `/api/dashboard/interview?interviewId=${demoInterviewId}`
      );

      const dashboardJson = (await dashboardResponse.json()) as Scorecard;
      setDashboardScorecard(dashboardJson);
      setInterviewPhase("complete");
      appendPanelFeed("orchestrator", `Human decision recorded: ${decision}.`);
    } finally {
      setDecisionLoading(false);
    }
  };

  const panelById = (id: string) => panels.find((panel) => panel.id === id);
  const candidatePanels = ["recruiter", "technical", "culture", "domain"].map(
    (id) => panelById(id)
  );
  const activeSpecialistPanel =
    candidatePanels.find((panel) => panel?.status === "active") ??
    panelById("recruiter");
  const orchestratorPanel = panelById("orchestrator");
  const orchestratorIsSpeaking = orchestratorPanel?.status === "active";
  const currentSpeaker = orchestratorIsSpeaking
    ? orchestratorPanel
    : activeSpecialistPanel;
  const orchestratorShadowed = !orchestratorIsSpeaking;
  const candidateOnlyMode = true;

  return (
    <div className="relative h-screen w-full overflow-hidden bg-[#020617] text-slate-100">
      <div className="pointer-events-none absolute inset-0 opacity-[0.04] [background-image:linear-gradient(rgba(56,189,248,0.5)_1px,transparent_1px),linear-gradient(90deg,rgba(56,189,248,0.5)_1px,transparent_1px)] [background-size:40px_40px]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_-20%,rgba(14,165,233,0.16),transparent_50%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background:repeating-linear-gradient(to_bottom,transparent_0px,transparent_2px,rgba(56,189,248,0.5)_3px)]" />

      <HasOpenAIKey />

      {candidateOnlyMode || viewMode === "candidate" ? (
        <div className="relative mx-auto flex h-full max-w-5xl flex-col gap-4 p-6">
          <header className="flex items-center justify-between rounded-xl border border-slate-700/50 bg-slate-900/80 px-4 py-3">
            <div>
              <h1 className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-200">
                Candidate Interview Portal
              </h1>
              <p className="text-xs text-slate-400">
                Moderator-led panel simulation.
              </p>
            </div>
          </header>

          <Card className="border border-slate-700/60 bg-slate-900/80 p-6 text-slate-200">
            <h2 className="text-lg font-semibold text-cyan-100">
              Welcome, Alex Candidate
            </h2>
            <p className="mt-2 text-sm text-slate-300">
              You are in an AI-powered panel simulation. The orchestrator
              introduces and moderates, then specialist interviewers drive the
              conversation with questions.
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-700/60 bg-slate-800/70 p-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">
                  Interview ID
                </p>
                <p className="mt-1 text-sm text-slate-100">{demoInterviewId}</p>
              </div>
              <div className="rounded-lg border border-slate-700/60 bg-slate-800/70 p-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">
                  Current Phase
                </p>
                <p className="mt-1 text-sm text-cyan-200">{interviewPhase}</p>
              </div>
              <div className="rounded-lg border border-slate-700/60 bg-slate-800/70 p-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">
                  Status
                </p>
                <p className="mt-1 text-sm text-emerald-300">Connected</p>
              </div>
            </div>
            <div className="mt-4">
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  className="bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30"
                  onClick={() => void runInterviewDrill()}
                  disabled={phase2Loading || interviewPhase !== "idle"}
                >
                  {phase2Loading ? "Running interview..." : "Start interview"}
                </Button>
                <button
                  type="button"
                  onClick={() => void handleVoiceInput()}
                  disabled={isTranscribing}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-full border ${
                    isRecording
                      ? "border-cyan-400 bg-cyan-500/30 text-cyan-100"
                      : "border-slate-600 bg-slate-800/70 text-slate-300"
                  } disabled:opacity-40`}
                  aria-label={
                    isRecording ? "Stop voice input" : "Start voice input"
                  }
                >
                  <MicrophoneIcon size={14} />
                </button>
              </div>
            </div>
          </Card>

          <main className="grid min-h-0 flex-1 grid-cols-1 gap-4">
            <section className="rounded-2xl border border-slate-700/60 bg-slate-900/80 p-6">
              <div className="relative mx-auto h-[430px] w-full max-w-[820px]">
                <div
                  className={`absolute left-1/2 top-1/2 flex h-32 w-32 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border text-center ${
                    panelById("orchestrator")?.status === "active"
                      ? "border-emerald-400/80 bg-emerald-950/25 ring-1 ring-emerald-400/35"
                      : "border-cyan-500/45 bg-slate-900/70"
                  }`}
                >
                  <p className="text-xs uppercase tracking-wide text-cyan-300">
                    Orchestrator
                  </p>
                  <p className="mt-1 text-sm font-semibold text-cyan-100">
                    Moderator
                  </p>
                  <p className="mt-1 text-[11px] text-slate-300">
                    {orchestratorShadowed ? "Stepping back" : "Guiding"}
                  </p>
                </div>

                {candidatePanels.map((panel, index) => {
                  if (!panel) return null;
                  const positions = [
                    "left-1/2 top-2 -translate-x-1/2",
                    "right-0 top-1/2 -translate-y-1/2",
                    "left-1/2 bottom-2 -translate-x-1/2",
                    "left-0 top-1/2 -translate-y-1/2"
                  ] as const;
                  const isActive = panel.id === currentSpeaker?.id;
                  return (
                    <div
                      key={`candidate-${panel.id}`}
                      className={`absolute ${positions[index]} flex h-32 w-32 flex-col items-center justify-center rounded-full border text-center ${activeCircleTone(isActive)}`}
                    >
                      <div className="mb-1 flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-cyan-200">
                        {panel.icon}
                      </div>
                      <p className="text-sm font-semibold text-slate-100">
                        {panel.name}
                      </p>
                      <p className="mt-1 px-2 text-[10px] text-slate-400">
                        {isActive ? "Asking question..." : "Listening"}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded-xl border border-slate-700/60 bg-slate-800/60 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">
                  Active Speaker
                </p>
                <p className="mt-2 text-base font-semibold text-cyan-200">
                  {currentSpeaker?.name ?? "Panel"}
                </p>
                <p className="text-sm text-slate-300">{currentSpeaker?.role}</p>
                <p className="mt-2 text-xs text-slate-400">
                  Only one speaker is highlighted at a time.
                </p>
              </div>

              <div className="rounded-xl border border-slate-700/60 bg-slate-800/60 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">
                  Interview Workspace
                </p>
                <p className="mt-2 text-sm text-slate-200">
                  {workspaceMode === "code"
                    ? "Code Window"
                    : workspaceMode === "whiteboard"
                      ? "Whiteboard"
                      : "Standby"}
                </p>
                <div className="mt-2 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-xs text-slate-300">
                  {workspacePrompt}
                </div>
              </div>

              <div className="rounded-xl border border-cyan-500/25 bg-cyan-950/20 p-4">
                <p className="text-xs uppercase tracking-wide text-cyan-300/70">
                  Candidate Guidance
                </p>
                <p className="mt-2 text-sm text-slate-200">
                  Answer naturally. Specialists lead each section while the
                  moderator coordinates.
                </p>
              </div>
            </section>
          </main>
        </div>
      ) : (
        <ManagerWarRoom
          showDebug={showDebug}
          setShowDebug={setShowDebug}
          switchView={switchView}
          clearHistory={clearHistory}
          setPanels={setPanels}
          setInterviewPhase={setInterviewPhase}
          setDashboardScorecard={setDashboardScorecard}
          runInterviewDrill={runInterviewDrill}
          synthesizeRecommendation={synthesizeRecommendation}
          phase2Loading={phase2Loading}
          interviewPhase={interviewPhase}
          dashboardScorecard={dashboardScorecard}
          submitHumanDecision={submitHumanDecision}
          decisionLoading={decisionLoading}
          panelById={panelById}
          managerDecisionNotes={managerDecisionNotes}
          setManagerDecisionNotes={setManagerDecisionNotes}
          setWorkspaceMode={setWorkspaceMode}
          setWorkspacePrompt={setWorkspacePrompt}
        />
      )}
    </div>
  );
}

const providerStatusPromise = fetch("/api/provider/status").then(
  (res) => res.json() as Promise<{ success: boolean; provider?: string }>
);

function HasOpenAIKey() {
  const providerStatus = use(providerStatusPromise);
  if (!providerStatus.success) {
    return (
      <div className="fixed inset-x-0 top-0 z-50 bg-red-500/10 backdrop-blur-sm">
        <div className="mx-auto max-w-3xl p-4">
          <div className="rounded-lg border border-red-500/30 bg-slate-900/95 p-4 text-sm text-red-300">
            <p className="font-semibold">AI Provider Not Configured</p>
            <p className="mt-1 text-red-300/70">
              Configure AI provider credentials in Worker secrets. Provider:{" "}
              <code className="rounded bg-red-500/10 px-1 text-red-400">
                {providerStatus.provider ?? "unknown"}
              </code>
            </p>
          </div>
        </div>
      </div>
    );
  }
  return null;
}
