import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Boxes,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Code2,
  Copy,
  ExternalLink,
  FileCode2,
  FolderGit2,
  Github,
  GitBranch,
  GitCommitHorizontal,
  Layers3,
  LoaderCircle,
  Menu,
  MessageSquareText,
  Network,
  PanelLeftClose,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Star,
  X,
  Zap,
} from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type {
  AnalysisRecord,
  ArchitectureLayer,
  ConceptDetail,
  ConceptToLearn,
  Difficulty,
  RepoMeta,
} from "@/lib/analysis-schema";
import {
  askCodebase,
  collectContext,
  explainConcept,
  loadAnalysis,
  previewRepository,
  resolveRepository,
  runAnalysis,
} from "@/lib/codecompass.functions";

type View = "overview" | "architecture" | "start" | "concepts" | "ask";
type AppFailure = {
  code: string;
  message: string;
  action?: "analyze" | "reanalyze" | "concept" | "ask";
  retryAfterSeconds?: number;
  limitScope?: "visitor" | "ip" | "visitor_resource" | null;
};
type ChatMessage = { role: "user" | "assistant"; content: string; referencedFiles?: string[] };
type ValidationPhase = "idle" | "validating" | "found" | "ready";
type AppPhase = "booting" | "idle" | "restoring" | "analyzing" | "ready";
const VIEWS: { id: View; label: string; icon: typeof Boxes }[] = [
  { id: "overview", label: "Overview", icon: Boxes },
  { id: "architecture", label: "Architecture", icon: Network },
  { id: "start", label: "Start Here", icon: BookOpen },
  { id: "concepts", label: "Concepts", icon: BrainCircuit },
  { id: "ask", label: "Ask", icon: MessageSquareText },
];
const STAGES = [
  "Validating repository",
  "Reading repository",
  "Detecting technologies",
  "Selecting important files",
  "Analyzing codebase",
  "Building learning path",
  "Saving analysis",
];
const STAGE_MILESTONES = [10, 25, 38, 50, 85, 95, 100] as const;
const STAGE_STATUS = [
  "Checking the repository details...",
  "Reading the repository structure...",
  "Reviewing the detected technologies...",
  "Preparing the selected repository context...",
  "Understanding project structure...",
  "Organizing the repository learning path...",
  "Saving the completed analysis...",
] as const;
const ANALYSIS_STATUS = [
  "Understanding project structure...",
  "Inspecting selected source files...",
  "Identifying architectural boundaries...",
  "Mapping relationships between components...",
  "Finding the best files to read first...",
  "Connecting repository concepts...",
  "Building a beginner-friendly mental model...",
] as const;
const QUESTIONS = [
  "How does data flow through this application?",
  "Where should I start reading the code?",
  "What are the main architectural boundaries?",
  "Which files are most important and why?",
];
const ERROR_TITLES: Record<string, string> = {
  app_network: "CodeCompass is unavailable",
  invalid_input: "Enter a valid GitHub repository",
  not_found: "Repository not found",
  private: "Private repository",
  forbidden: "Repository is not public",
  rate_limit: "GitHub rate limit reached",
  rate_limited: "Usage limit reached",
  too_large: "Repository is too large",
  unsupported: "Unsupported repository",
  empty_repo: "Repository is empty",
  ai_gateway: "AI analysis failed",
  ai_config: "AI service is not configured",
  ai_auth: "AI configuration is invalid",
  ai_credits: "Anthropic credits exhausted",
  ai_request: "AI request configuration error",
  ai_network: "AI service is unavailable",
  ai_rate_limit: "AI service is busy",
  ai_timeout: "AI request timed out",
  ai_overloaded: "AI service is overloaded",
  ai_context_limit: "Repository context is too large",
  ai_error: "AI analysis failed",
  ai_empty: "AI returned an empty response",
  ai_malformed: "Analysis could not be validated",
  network: "GitHub is unavailable",
  github: "GitHub API failed",
  storage: "Storage failed",
  no_analysis: "No saved analysis found",
  chat: "Question could not be answered",
};

const VISITOR_STORAGE_KEY = "codecompass-anonymous-visitor";
const VISITOR_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let memoryVisitorId: string | null = null;

function createAnonymousVisitorId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function anonymousVisitorId(): string {
  if (memoryVisitorId) return memoryVisitorId;
  try {
    const stored = window.localStorage.getItem(VISITOR_STORAGE_KEY);
    if (stored && VISITOR_ID_PATTERN.test(stored)) {
      memoryVisitorId = stored;
      return stored;
    }
    const created = createAnonymousVisitorId();
    window.localStorage.setItem(VISITOR_STORAGE_KEY, created);
    memoryVisitorId = created;
    return created;
  } catch {
    memoryVisitorId = createAnonymousVisitorId();
    return memoryVisitorId;
  }
}

function Logo() {
  return (
    <div className="brand" aria-label="CodeCompass">
      <img className="brand-mark" src="/assets/codecompass-logo.png" alt="" />
      <span aria-hidden="true">CodeCompass</span>
    </div>
  );
}
function shortSha(sha: string) {
  return sha.slice(0, 7);
}
function formatNumber(value: number) {
  return new Intl.NumberFormat("en", {
    notation: value > 999 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatRetryCountdown(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  return `${Math.ceil(seconds / 3600)}h`;
}
function conciseText(value: string, maxLength = 124) {
  const normalized = value.trim().replace(/\s+/g, " ");
  const firstSentence = normalized.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? normalized;
  if (firstSentence.length <= maxLength) return firstSentence;

  const shortened = firstSentence
    .slice(0, maxLength + 1)
    .replace(/\s+\S*$/, "")
    .trim();
  return `${shortened || firstSentence.slice(0, maxLength).trim()}…`;
}
function difficultyClass(value: Difficulty) {
  return `difficulty difficulty-${value}`;
}

function CopyButton({
  value,
  label = "Copy path",
  successMessage = "Copied",
  helperText,
}: {
  value: string;
  label?: string;
  successMessage?: string;
  helperText?: string;
}) {
  const [copied, setCopied] = useState(false);
  const button = (
    <button
      className="quiet-button"
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), helperText ? 2600 : 1400);
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? "Copied" : label}
    </button>
  );
  if (!helperText) return button;
  return (
    <span className="copy-control">
      {button}
      {copied && (
        <span className="copy-feedback" role="status">
          <strong>{successMessage}</strong>
          <small>{helperText}</small>
        </span>
      )}
    </span>
  );
}
function ErrorNotice({ error, onRetry }: { error: AppFailure; onRetry?: () => void }) {
  return (
    <div className="error-notice" role="alert">
      <span className="error-icon">
        <AlertTriangle size={20} />
      </span>
      <div>
        <strong>{ERROR_TITLES[error.code] ?? "Something went wrong"}</strong>
        <p>{error.message}</p>
      </div>
      {onRetry && (
        <button type="button" className="secondary-button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

const SERVER_UNAVAILABLE: AppFailure = {
  code: "app_network",
  message: "CodeCompass could not reach its server. Check your connection and try again.",
};

function RepositoryHeader({
  record,
  stale,
  onMenu,
  onSwitch,
  onReanalyze,
}: {
  record: AnalysisRecord;
  stale: boolean;
  onMenu: () => void;
  onSwitch: () => void;
  onReanalyze: () => void;
}) {
  return (
    <header className="topbar">
      <button type="button" className="mobile-menu" onClick={onMenu} aria-label="Open navigation">
        <Menu size={20} />
      </button>
      <button className="repo-chip" type="button" onClick={onSwitch}>
        <FolderGit2 size={15} />
        <span className="repo-chip-name">
          <span className="repo-owner">{record.meta.owner}</span>
          <span className="repo-separator"> / </span>
          <b>{record.meta.repo}</b>
        </span>
      </button>
      <span className="meta-chip">
        <GitBranch size={13} />
        {record.meta.defaultBranch}
      </span>
      <span className="meta-chip sha">
        <GitCommitHorizontal size={13} />
        {shortSha(record.commitSha)}
      </span>
      <span className={`status-chip ${stale ? "status-stale" : ""}`}>
        <Circle size={8} fill="currentColor" />
        {stale ? "Update available" : "Up to date"}
      </span>
      <div className="topbar-spacer" />
      <a
        className="header-action hide-small"
        href={record.meta.htmlUrl}
        target="_blank"
        rel="noreferrer"
      >
        <Github size={15} /> GitHub
      </a>
      <button className="header-action" type="button" onClick={onReanalyze}>
        <RefreshCw size={15} />
        <span className="hide-small">Re-analyze</span>
      </button>
    </header>
  );
}
function Sidebar({
  view,
  onView,
  onSwitch,
  open,
  onClose,
  collapsed,
  onToggleCollapsed,
}: {
  view: View;
  onView: (view: View) => void;
  onSwitch: () => void;
  open: boolean;
  onClose: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  return (
    <>
      <button
        type="button"
        className={`drawer-backdrop ${open ? "shown" : ""}`}
        onClick={onClose}
        aria-label="Close navigation"
      />
      <aside className={`sidebar ${open ? "sidebar-open" : ""} ${collapsed ? "is-collapsed" : ""}`}>
        <div className="sidebar-heading">
          <Logo />
          <button
            className="sidebar-collapse"
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
          >
            <PanelLeftClose size={18} />
          </button>
          <button
            className="drawer-close"
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
          >
            <PanelLeftClose size={20} />
          </button>
        </div>
        <nav>
          {VIEWS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={view === item.id ? "active" : ""}
                aria-current={view === item.id ? "page" : undefined}
                aria-label={collapsed ? item.label : undefined}
                data-tooltip={item.label}
                onClick={() => {
                  onView(item.id);
                  onClose();
                }}
              >
                <Icon size={17} />
                <span className="sidebar-item-label">{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-divider" />
        <button
          type="button"
          className="utility-link"
          onClick={onSwitch}
          aria-label={collapsed ? "Switch repository" : undefined}
          data-tooltip="Switch repository"
        >
          <RefreshCw size={16} />
          <span className="sidebar-item-label">Switch repository</span>
        </button>
        <div
          className="sidebar-foot"
          role="status"
          tabIndex={collapsed ? 0 : -1}
          aria-label="Public repositories only · read-only"
          data-tooltip="Public repositories only · read-only"
        >
          <CheckCircle2 size={14} />
          <small>Public repos · read-only</small>
        </div>
      </aside>
    </>
  );
}

function Landing({
  input,
  setInput,
  preview,
  validationPhase,
  error,
  onPreview,
  onAnalyze,
}: {
  input: string;
  setInput: (v: string) => void;
  preview: RepoMeta | null;
  validationPhase: ValidationPhase;
  error: AppFailure | null;
  onPreview: () => void;
  onAnalyze: () => void;
}) {
  const examples = ["facebook/react", "supabase/supabase", "vitejs/vite"];
  const validationBusy = validationPhase === "validating" || validationPhase === "found";
  const buttonContent =
    validationPhase === "validating" ? (
      <>
        <LoaderCircle className="spin" size={18} /> Validating...
      </>
    ) : validationPhase === "found" ? (
      <>
        <Check size={18} /> Repository found
      </>
    ) : preview ? (
      <>
        <Zap size={18} /> Analyze codebase
      </>
    ) : (
      <>
        <Zap size={18} /> Validate repository
      </>
    );
  return (
    <main className="landing">
      <header className="landing-header">
        <Logo />
        <span className="version">v1.0 MVP</span>
        <a href="https://github.com" target="_blank" rel="noreferrer">
          <Github size={16} /> GitHub
        </a>
      </header>
      <section className="hero">
        <div className="hero-kicker">Repository onboarding</div>
        <h1>
          Understand a codebase
          <br />
          <span>before you dive in</span>
        </h1>
        <p>
          Paste a public GitHub repository to see what it does, how it fits together, and where to
          start reading.
        </p>
        <form
          className="repo-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (preview) onAnalyze();
            else onPreview();
          }}
        >
          <div className="repo-input-wrap">
            <Github size={19} />
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="github.com/owner/repository"
              aria-label="GitHub repository"
            />
          </div>
          <button
            className={`primary-button${validationPhase === "found" ? " validation-success" : ""}`}
            disabled={validationBusy || !input.trim()}
            aria-live="polite"
          >
            {buttonContent}
          </button>
          <div className="input-meta">
            <span>
              <CheckCircle2 size={14} /> Public repositories
            </span>
            <span>Read-only analysis</span>
            <span>GitHub API</span>
          </div>
          <div className="examples">
            <span>Examples</span>
            {examples.map((x) => (
              <button type="button" key={x} onClick={() => setInput(x)}>
                {x}
              </button>
            ))}
          </div>
          {preview && (
            <div className="repo-preview" aria-live="polite">
              <span className="preview-icon">
                <FolderGit2 />
              </span>
              <div>
                <strong>
                  {preview.owner} / {preview.repo}
                </strong>
                <p>{preview.description || "No repository description provided."}</p>
              </div>
              <div className="preview-stats">
                <span>
                  <Star size={13} fill="currentColor" /> {formatNumber(preview.stars)}
                </span>
                <span>{preview.language || "Mixed"}</span>
                <span className="preview-ready">
                  <CheckCircle2 size={13} /> Ready to analyze
                </span>
              </div>
            </div>
          )}
        </form>
        {error && <ErrorNotice error={error} onRetry={onPreview} />}
      </section>
      <section className="workflow">
        <div className="section-heading">
          <div>
            <h2>From repository to reading plan</h2>
          </div>
        </div>
        <div className="workflow-grid">
          <article>
            <span className="stage-tag">1</span>
            <Search />
            <h3>Validate the repository</h3>
            <p>Confirm the public repository and inspect its latest commit before work begins.</p>
          </article>
          <article>
            <span className="stage-tag blue">2</span>
            <Network />
            <h3>Map the architecture</h3>
            <p>Read high-signal files and connect the repository’s actual layers and concepts.</p>
          </article>
          <article>
            <span className="stage-tag amber">3</span>
            <BookOpen />
            <h3>Follow a guided path</h3>
            <p>Learn from ranked files, tailored concepts, and grounded answers.</p>
          </article>
        </div>
      </section>
    </main>
  );
}

function AnalysisProgress({
  input,
  stage,
  error,
  onRetry,
  onCancel,
}: {
  input: string;
  stage: number;
  error: AppFailure | null;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const { progress, elapsedSeconds, status } = usePipelineProgress(stage, Boolean(error));
  const stageNumber = Math.min(Math.max(stage, 0), STAGES.length - 1);
  const longWaitMessage =
    elapsedSeconds >= 60
      ? "Still working. CodeCompass is analyzing the selected repository context."
      : elapsedSeconds >= 30
        ? "Large repositories can take a little longer to understand."
        : null;
  return (
    <main className="analysis-page">
      <div className="analysis-top">
        <Logo />
        <span className="engine-badge">
          <Circle size={8} fill="currentColor" /> Engine running
        </span>
      </div>
      <section className="analysis-card">
        <div>
          <span className="eyebrow">Analyzing repository</span>
          <h1>{input}</h1>
          <p>
            Building a trustworthy mental model from repository metadata and selected source files.
          </p>
        </div>
        <div className="progress-card">
          <div>
            <span>Analysis progress</span>
            <strong>{progress}%</strong>
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-label="Repository analysis progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
          <small>
            Stage {stageNumber + 1} of {STAGES.length} · {STAGES[stageNumber]}
          </small>
        </div>
      </section>
      {error ? (
        <ErrorNotice error={error} onRetry={onRetry} />
      ) : (
        <section className="stage-list">
          <div className="section-heading">
            <h2>Analysis stages</h2>
          </div>
          {STAGES.map((name, i) => (
            <article
              key={name}
              className={i === stageNumber ? "current" : i < stageNumber ? "done" : "queued"}
            >
              <span className="stage-state">
                {i < stageNumber ? (
                  <Check size={18} />
                ) : i === stageNumber ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <Circle size={18} />
                )}
              </span>
              <div>
                <h3>{name}</h3>
                <p>
                  {i < stageNumber
                    ? "Completed successfully"
                    : i === stageNumber
                      ? status
                      : "Waiting for the previous stage"}
                </p>
                {i === stageNumber && elapsedSeconds >= 10 && (
                  <small className="stage-elapsed">
                    {stageNumber === 4 ? "Analyzing" : "Working"} for {elapsedSeconds}s
                  </small>
                )}
                {i === stageNumber && longWaitMessage && (
                  <small className="long-wait-message">{longWaitMessage}</small>
                )}
              </div>
              {i === stageNumber ? (
                <span className="active-stage-progress" aria-hidden="true">
                  <strong>{progress}%</strong>
                  <span>In progress</span>
                </span>
              ) : (
                <span className="stage-label">{i < stageNumber ? "Done" : "Queued"}</span>
              )}
            </article>
          ))}
        </section>
      )}
      <button className="analysis-back-button" type="button" onClick={onCancel}>
        <ArrowLeft size={16} /> Back to repository input
      </button>
    </main>
  );
}

function RestorationState({
  input,
  error,
  onReset,
}: {
  input: string | undefined;
  error: AppFailure | null;
  onReset: () => void;
}) {
  return (
    <main className="restore-page">
      <section className={`restore-state ${error ? "restore-error" : ""}`} aria-live="polite">
        <Logo />
        {error ? (
          <>
            <div className="restore-copy">
              <span className="eyebrow">Saved analysis</span>
              <h1>Could not load saved analysis</h1>
              {input && <p>{input}</p>}
            </div>
            <ErrorNotice error={error} />
            <button type="button" className="secondary-button" onClick={onReset}>
              Choose another repository
            </button>
          </>
        ) : (
          <>
            <LoaderCircle className="spin restore-spinner" size={24} aria-hidden="true" />
            <div className="restore-copy">
              <h1>{input ? "Loading saved analysis" : "Loading CodeCompass"}</h1>
              {input && <p>{input}</p>}
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function usePipelineProgress(stage: number, paused: boolean) {
  const safeStage = Math.min(Math.max(stage, 0), STAGES.length - 1);
  const stageFloor = safeStage === 0 ? 0 : (STAGE_MILESTONES[safeStage - 1] ?? 0);
  const stageMilestone = STAGE_MILESTONES[safeStage] ?? 100;
  const stageCeiling = Math.max(stageFloor, stageMilestone - 1);
  const [progressState, setProgressState] = useState({
    stage: safeStage,
    progress: stageFloor,
    elapsedSeconds: 0,
  });

  useEffect(() => {
    const startedAt = Date.now();
    setProgressState({
      stage: safeStage,
      progress: stageFloor,
      elapsedSeconds: 0,
    });
    if (paused) return;

    const update = () => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      const timeConstant = safeStage === 4 ? 18 : 7;
      const eased = 1 - Math.exp(-elapsedSeconds / timeConstant);
      const estimate = Math.floor(stageFloor + (stageCeiling - stageFloor) * eased);
      setProgressState({
        stage: safeStage,
        progress: Math.min(stageCeiling, Math.max(stageFloor, estimate)),
        elapsedSeconds,
      });
    };
    update();
    const timer = window.setInterval(update, 500);
    return () => window.clearInterval(timer);
  }, [paused, safeStage, stageCeiling, stageFloor]);

  const elapsedSeconds = progressState.stage === safeStage ? progressState.elapsedSeconds : 0;
  const progress =
    progressState.stage === safeStage ? Math.max(stageFloor, progressState.progress) : stageFloor;
  const messages = safeStage === 4 ? ANALYSIS_STATUS : STAGE_STATUS;
  const status =
    safeStage === 4
      ? (messages[Math.floor(elapsedSeconds / 5) % messages.length] ?? ANALYSIS_STATUS[0])
      : (STAGE_STATUS[safeStage] ?? STAGE_STATUS[0]);

  return { progress, elapsedSeconds, status };
}

function RepoBanner({
  record,
  stale,
  latestSha,
  onReanalyze,
}: {
  record: AnalysisRecord;
  stale: boolean;
  latestSha: string | null;
  onReanalyze: () => void;
}) {
  return (
    <div className={`repo-banner ${stale ? "stale" : ""}`}>
      {stale ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
      <span>
        {stale ? (
          <>
            Newer commit <b>{latestSha ? shortSha(latestSha) : "detected"}</b> is available. Viewing{" "}
            <b>{shortSha(record.commitSha)}</b>.
          </>
        ) : (
          <>
            Analysis is up to date · commit <b>{shortSha(record.commitSha)}</b>
          </>
        )}
      </span>
      {stale && (
        <button type="button" onClick={onReanalyze}>
          Analyze latest version <ArrowRight size={14} />
        </button>
      )}
    </div>
  );
}

function Overview({ record, onView }: { record: AnalysisRecord; onView: (v: View) => void }) {
  const { analysis, snapshot, meta } = record;
  const architectureSteps = analysis.architecture.slice(0, 4);
  const firstFiles = [...analysis.importantFiles]
    .sort((a, b) => a.recommendedOrder - b.recommendedOrder)
    .slice(0, 3);
  const firstConcepts = [...analysis.conceptsToLearn]
    .sort((a, b) => a.recommendedOrder - b.recommendedOrder)
    .slice(0, 3);

  return (
    <div className="view-stack overview-page">
      <section className="overview-intro" aria-labelledby="overview-project-heading">
        <h2 id="overview-project-heading">What is this project?</h2>
        <h1>{meta.repo}</h1>
        <p className="overview-summary">{conciseText(analysis.summary.whatItDoes, 180)}</p>
        <details className="technical-disclosure">
          <summary>
            <ChevronRight size={15} aria-hidden="true" />
            Technical details
          </summary>
          <dl>
            <div>
              <dt>Project type</dt>
              <dd>{analysis.summary.projectType}</dd>
            </div>
            <div>
              <dt>Who it is for</dt>
              <dd>{analysis.summary.whoItsFor}</dd>
            </div>
            <div>
              <dt>Technologies</dt>
              <dd>{analysis.technologies.map((technology) => technology.name).join(", ")}</dd>
            </div>
          </dl>
        </details>
      </section>

      <section className="overview-section" aria-labelledby="overview-architecture-heading">
        <div className="section-heading">
          <div>
            <h2 id="overview-architecture-heading">How does it work?</h2>
            <p>A simple view of how the main pieces fit together.</p>
          </div>
        </div>
        {architectureSteps.length > 0 && (
          <ol className="overview-flow">
            {architectureSteps.map((layer, index) => (
              <li key={layer.id}>
                <span>{index + 1}</span>
                <div>
                  <strong>{layer.name}</strong>
                  <p>{conciseText(layer.description, 96)}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
        <button
          className="overview-next-action"
          type="button"
          onClick={() => onView("architecture")}
        >
          See architecture <ArrowRight size={15} />
        </button>
      </section>

      <section className="overview-section" aria-labelledby="overview-start-heading">
        <div className="section-heading">
          <div>
            <h2 id="overview-start-heading">Start here</h2>
            <p>Read these files first to build a useful mental model.</p>
          </div>
        </div>
        <ol className="overview-reading-preview">
          {firstFiles.map((file, index) => (
            <li key={file.path}>
              <span>{index + 1}</span>
              <div>
                <code title={file.path}>{file.path}</code>
                <p>{conciseText(file.whyItMatters, 130)}</p>
              </div>
            </li>
          ))}
        </ol>
        <button className="overview-next-action" type="button" onClick={() => onView("start")}>
          Start reading <ArrowRight size={15} />
        </button>
      </section>

      <section className="overview-section" aria-labelledby="overview-learn-heading">
        <div className="section-heading">
          <div>
            <h2 id="overview-learn-heading">Learn these first</h2>
            <p>The key ideas that will make the repository easier to understand.</p>
          </div>
        </div>
        <ol className="overview-concept-preview">
          {firstConcepts.map((concept) => (
            <li key={concept.name}>
              <div>
                <strong>{concept.name}</strong>
                <span className={difficultyClass(concept.difficulty)}>{concept.difficulty}</span>
              </div>
              <p>{conciseText(concept.whyItMattersHere, 130)}</p>
            </li>
          ))}
        </ol>
        <button className="overview-next-action" type="button" onClick={() => onView("concepts")}>
          Learn the key concepts <ArrowRight size={15} />
        </button>
      </section>

      <section
        className="overview-section project-details"
        aria-labelledby="project-details-heading"
      >
        <div className="section-heading">
          <div>
            <h2 id="project-details-heading">Project details</h2>
            <p>Repository and analysis information.</p>
          </div>
        </div>
        <dl className="project-details-list">
          <div>
            <dt>Primary language</dt>
            <dd>{meta.language || "Mixed"}</dd>
          </div>
          <div>
            <dt>Default branch</dt>
            <dd>{meta.defaultBranch}</dd>
          </div>
          <div>
            <dt>Commit</dt>
            <dd title={record.commitSha}>{shortSha(record.commitSha)}</dd>
          </div>
          <div>
            <dt>Files</dt>
            <dd>{formatNumber(snapshot.totalFiles)}</dd>
          </div>
          <div>
            <dt>Directories</dt>
            <dd>{formatNumber(snapshot.directories)}</dd>
          </div>
          <div>
            <dt>Analyzed files</dt>
            <dd>{formatNumber(snapshot.analyzedFiles)}</dd>
          </div>
          <div>
            <dt>Cache status</dt>
            <dd>{record.cached ? "Cached analysis" : "Fresh analysis"}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

function ArchitectureDetails({
  layer,
  layers,
  onSelectConnected,
  showTitle = true,
}: {
  layer: ArchitectureLayer;
  layers: ArchitectureLayer[];
  onSelectConnected: (id: string) => void;
  showTitle?: boolean;
}) {
  return (
    <>
      {showTitle && (
        <>
          <span className="eyebrow">Selected layer</span>
          <h2>{layer.name}</h2>
        </>
      )}
      <section>
        <h3>Why this matters</h3>
        <p>{layer.description}</p>
      </section>
      <section>
        <h3>Connected layers</h3>
        <div className="tag-row">
          {layer.connectsTo.length ? (
            layer.connectsTo.map((id) => (
              <button type="button" key={id} onClick={() => onSelectConnected(id)}>
                {layers.find((candidate) => candidate.id === id)?.name ?? id}
              </button>
            ))
          ) : (
            <span>Standalone boundary</span>
          )}
        </div>
      </section>
      <section>
        <h3>Associated files</h3>
        <ul className="file-list">
          {layer.relatedFiles.map((file) => (
            <li key={file}>
              <FileCode2 />
              <span title={file}>{file}</span>
            </li>
          ))}
        </ul>
      </section>
      {layer.concepts?.length ? (
        <section>
          <h3>Related concepts</h3>
          <div className="tag-row">
            {layer.concepts.map((concept) => (
              <span key={concept}>{concept}</span>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function Architecture({ layers }: { layers: ArchitectureLayer[] }) {
  const [selectedId, setSelectedId] = useState(layers[0]?.id ?? "");
  const layerRefs = useRef(new Map<string, HTMLDivElement>());
  const selected = layers.find((x) => x.id === selectedId);
  useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 769px)");
    const restoreDesktopSelection = (event: MediaQueryListEvent) => {
      if (event.matches) setSelectedId((current) => current || layers[0]?.id || "");
    };
    desktopQuery.addEventListener("change", restoreDesktopSelection);
    return () => desktopQuery.removeEventListener("change", restoreDesktopSelection);
  }, [layers]);
  const selectLayer = (id: string) => {
    if (window.matchMedia("(max-width: 768px)").matches) {
      setSelectedId((current) => (current === id ? "" : id));
      return;
    }
    setSelectedId(id);
  };
  const selectConnectedLayer = (id: string) => {
    if (!layers.some((layer) => layer.id === id)) return;
    setSelectedId(id);
    if (!window.matchMedia("(max-width: 768px)").matches) return;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const target = layerRefs.current.get(id);
        if (!target) return;
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" });
        target.querySelector<HTMLButtonElement>(".layer-node")?.focus({ preventScroll: true });
      });
    });
  };
  return (
    <div className="architecture-layout">
      <section className="architecture-main">
        <PageHeading
          kicker="Architecture"
          title="How the pieces connect"
          text="Select a layer to inspect its responsibility, source files, and connections."
        />
        <div className="layer-map">
          {layers.map((layer, i) => (
            <div
              key={layer.id}
              className="layer-node-wrap"
              ref={(element) => {
                if (element) layerRefs.current.set(layer.id, element);
                else layerRefs.current.delete(layer.id);
              }}
            >
              <button
                type="button"
                className={`layer-node ${selected?.id === layer.id ? "selected" : ""}`}
                aria-expanded={selected?.id === layer.id}
                aria-controls={`mobile-layer-details-${layer.id}`}
                onClick={() => selectLayer(layer.id)}
              >
                <span className="layer-number">Layer {String(i + 1).padStart(2, "0")}</span>
                <div>
                  <Layers3 />
                  <h2>{layer.name}</h2>
                </div>
                <p>{layer.description}</p>
                <div className="tag-row">
                  {layer.relatedFiles.slice(0, 2).map((file) => (
                    <span key={file} title={file}>
                      {file}
                    </span>
                  ))}
                </div>
                <ChevronRight />
              </button>
              {selected?.id === layer.id && (
                <div
                  className="mobile-layer-details"
                  id={`mobile-layer-details-${layer.id}`}
                  aria-label={`${layer.name} details`}
                >
                  <ArchitectureDetails
                    layer={layer}
                    layers={layers}
                    onSelectConnected={selectConnectedLayer}
                    showTitle={false}
                  />
                </div>
              )}
              {i < layers.length - 1 &&
                (layer.connectsTo.includes(layers[i + 1]?.id ?? "") ||
                  layers[i + 1]?.connectsTo.includes(layer.id)) && (
                  <div className="connector">
                    <span /> connects to <span />
                  </div>
                )}
            </div>
          ))}
        </div>
      </section>
      {selected && (
        <aside className="inspector desktop-architecture-inspector">
          <ArchitectureDetails
            layer={selected}
            layers={layers}
            onSelectConnected={selectConnectedLayer}
          />
        </aside>
      )}
    </div>
  );
}
function PageHeading({ kicker, title, text }: { kicker: string; title: string; text: string }) {
  return (
    <div className="page-heading">
      <span className="eyebrow">{kicker}</span>
      <h1>{title}</h1>
      <p>{text}</p>
    </div>
  );
}

function fileReadingHint(file: AnalysisRecord["analysis"]["importantFiles"][number]) {
  if (file.beginnerExplanation.trim()) return conciseText(file.beginnerExplanation, 156);
  if (file.concepts.length) {
    return `Look for how this file connects ${file.concepts.slice(0, 3).join(", ")}.`;
  }
  if (file.category.trim()) {
    return `Notice the ${file.category.toLowerCase()} responsibilities this file brings together.`;
  }
  return conciseText(file.whyItMatters, 156);
}

function StartHere({ record }: { record: AnalysisRecord }) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const files = record.analysis.importantFiles;
  return (
    <div className="view-stack">
      <section className="page-hero">
        <span className="eyebrow">Start here</span>
        <h1>What should I read first?</h1>
        <p>{files.length} files, ordered from the best entry point to the core implementation.</p>
        <div className="reading-progress">
          <strong>
            {done.size} / {files.length} completed
          </strong>
          <div className="progress-track">
            <span style={{ width: `${files.length ? (done.size / files.length) * 100 : 0}%` }} />
          </div>
        </div>
      </section>
      <section>
        <div className="section-heading">
          <div>
            <h2>Reading order</h2>
          </div>
          <CopyButton value={files.map((x) => x.path).join("\n")} label="Copy reading plan" />
        </div>
        <div className="reading-list">
          {files.map((file) => (
            <article key={file.path} className={done.has(file.path) ? "file-done" : ""}>
              <span className="file-rank">{String(file.recommendedOrder).padStart(2, "0")}</span>
              <div className="file-copy">
                <div className="file-title">
                  <h3 title={file.path}>{file.path}</h3>
                  <span className={difficultyClass(file.difficulty)}>{file.difficulty}</span>
                </div>
                <div className="file-guidance">
                  <section>
                    <h4>Why read this?</h4>
                    <p>{conciseText(file.whyItMatters, 156)}</p>
                  </section>
                  <section>
                    <h4>What to look for</h4>
                    <p>{fileReadingHint(file)}</p>
                  </section>
                </div>
                <div className="file-actions">
                  <a
                    className="quiet-button"
                    href={`${record.meta.htmlUrl}/blob/${record.commitSha}/${file.path}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`View ${file.path} on GitHub`}
                  >
                    <ExternalLink size={14} />
                    View on GitHub
                  </a>
                  <CopyButton
                    value={file.path}
                    label="Copy file path"
                    successMessage="File path copied"
                    helperText="Paste it into your editor's Quick Open or repository search."
                  />
                  <button
                    type="button"
                    className="completion"
                    aria-pressed={done.has(file.path)}
                    aria-label={`${done.has(file.path) ? "Mark as incomplete" : "Mark complete"}: ${file.path}`}
                    onClick={() =>
                      setDone((current) => {
                        const next = new Set(current);
                        if (next.has(file.path)) next.delete(file.path);
                        else next.add(file.path);
                        return next;
                      })
                    }
                  >
                    {done.has(file.path) ? <Check size={14} /> : <Circle size={14} />}
                    {done.has(file.path) ? "Completed" : "Mark complete"}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function Concepts({ record }: { record: AnalysisRecord }) {
  const concepts = record.analysis.conceptsToLearn;
  const [selectedName, setSelectedName] = useState(concepts[0]?.name ?? "");
  const [detail, setDetail] = useState<ConceptDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AppFailure | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const requestId = useRef(0);
  const conceptsInFlight = useRef(new Set<string>());
  const selectorTrigger = useRef<HTMLButtonElement>(null);
  const selectorClose = useRef<HTMLButtonElement>(null);
  const selectorSheet = useRef<HTMLDivElement>(null);
  const load = useCallback(
    async (concept: ConceptToLearn) => {
      if (conceptsInFlight.current.has(concept.name)) return;
      conceptsInFlight.current.add(concept.name);
      const currentRequest = ++requestId.current;
      setSelectedName(concept.name);
      setDetail(null);
      setError(null);
      setLoading(true);
      try {
        const result = await explainConcept({
          data: {
            analysisId: record.analysisId,
            conceptName: concept.name,
            visitorId: anonymousVisitorId(),
          },
        });
        if (currentRequest !== requestId.current) return;
        if (result.ok) setDetail(result.detail);
        else setError(result);
      } catch {
        if (currentRequest === requestId.current) setError(SERVER_UNAVAILABLE);
      } finally {
        conceptsInFlight.current.delete(concept.name);
        if (currentRequest === requestId.current) setLoading(false);
      }
    },
    [record.analysisId],
  );
  useEffect(() => {
    const initial = concepts[0];
    if (initial) void load(initial);
  }, [concepts, load]);
  const selected = concepts.find((x) => x.name === selectedName) ?? concepts[0];
  const selectedIndex = selected
    ? concepts.findIndex((concept) => concept.name === selected.name)
    : 0;
  const selectConcept = (concept: ConceptToLearn) => {
    setSelectorOpen(false);
    if (concept.name !== selectedName) void load(concept);
  };
  useEffect(() => {
    if (!selectorOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const trigger = selectorTrigger.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => selectorClose.current?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectorOpen(false);
    };
    const desktopQuery = window.matchMedia("(min-width: 769px)");
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setSelectorOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    desktopQuery.addEventListener("change", closeOnDesktop);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", closeOnEscape);
      desktopQuery.removeEventListener("change", closeOnDesktop);
      document.body.style.overflow = previousOverflow;
      if (trigger?.getClientRects().length) trigger.focus();
      else previouslyFocused?.focus();
    };
  }, [selectorOpen]);
  const trapSelectorFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const buttons = Array.from(
      selectorSheet.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
    );
    const first = buttons[0];
    const last = buttons.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return (
    <div className="concept-layout">
      <section className="concept-nav">
        <PageHeading
          kicker="Concepts"
          title="Learn this repository"
          text="Concepts are ordered by dependency and grounded in the analyzed files."
        />
        {selected && (
          <div className="mobile-concept-navigation" aria-label="Concept navigation">
            <span>
              Concept {selectedIndex + 1} of {concepts.length}
            </span>
            <h2>{selected.name}</h2>
            <div className="mobile-concept-actions">
              <button
                type="button"
                disabled={selectedIndex <= 0}
                onClick={() => {
                  const previous = concepts[selectedIndex - 1];
                  if (previous) void load(previous);
                }}
              >
                <ArrowLeft size={16} /> Previous
              </button>
              <button
                type="button"
                disabled={selectedIndex >= concepts.length - 1}
                onClick={() => {
                  const next = concepts[selectedIndex + 1];
                  if (next) void load(next);
                }}
              >
                Next <ArrowRight size={16} />
              </button>
            </div>
            <button
              ref={selectorTrigger}
              className="all-concepts-button"
              type="button"
              aria-haspopup="dialog"
              aria-expanded={selectorOpen}
              onClick={() => setSelectorOpen(true)}
            >
              All concepts
              <ChevronRight size={16} />
            </button>
          </div>
        )}
        <div className="concept-list">
          {concepts.map((concept) => (
            <button
              type="button"
              key={concept.name}
              className={concept.name === selectedName ? "active" : ""}
              onClick={() => void load(concept)}
            >
              <span>{String(concept.recommendedOrder).padStart(2, "0")}</span>
              <div>
                <b>{concept.name}</b>
                <p>{concept.whyItMattersHere}</p>
                <div className="concept-meta">
                  <span className={difficultyClass(concept.difficulty)}>{concept.difficulty}</span>
                  {concept.prerequisites[0] && <span>After {concept.prerequisites[0]}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>
      {selectorOpen && (
        <div className="concept-selector-overlay">
          <button
            className="concept-selector-backdrop"
            type="button"
            aria-label="Close concept selector"
            onClick={() => setSelectorOpen(false)}
          />
          <div
            ref={selectorSheet}
            className="concept-selector-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="concept-selector-title"
            onKeyDown={trapSelectorFocus}
          >
            <div className="concept-selector-heading">
              <div>
                <span>Learning path</span>
                <h2 id="concept-selector-title">All concepts</h2>
              </div>
              <button
                ref={selectorClose}
                type="button"
                aria-label="Close concept selector"
                onClick={() => setSelectorOpen(false)}
              >
                <X size={19} />
              </button>
            </div>
            <div className="concept-selector-list">
              {concepts.map((concept, index) => {
                const current = concept.name === selectedName;
                return (
                  <button
                    type="button"
                    key={concept.name}
                    className={current ? "current" : ""}
                    aria-current={current ? "true" : undefined}
                    onClick={() => selectConcept(concept)}
                  >
                    <span>{String(concept.recommendedOrder || index + 1).padStart(2, "0")}</span>
                    <strong>{concept.name}</strong>
                    <span className="concept-selector-meta">
                      <span className={difficultyClass(concept.difficulty)}>
                        {concept.difficulty}
                      </span>
                      {current && <span className="concept-current-label">Current</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
      <section className="concept-detail">
        {loading && (
          <div className="detail-loading">
            <LoaderCircle className="spin" />
            <h2>Building this deep dive</h2>
            <p>Grounding the explanation in analyzed repository files…</p>
          </div>
        )}
        {error && <ErrorNotice error={error} onRetry={() => selected && void load(selected)} />}
        {detail && (
          <>
            <div className="detail-title">
              <span className="eyebrow">
                Concept {selected?.recommendedOrder} of {concepts.length}
              </span>
              <h1>{detail.name}</h1>
              <p>{detail.whyThisRepoUsesIt}</p>
            </div>
            <DetailSection title="What it is" icon={<BrainCircuit />}>
              <>
                <p>{detail.whatIsIt}</p>
                <p className="detail-support">{detail.beginnerExplanation}</p>
              </>
            </DetailSection>
            <DetailSection title="Why it matters here" icon={<Network />}>
              <>
                <p>{detail.whyThisRepoUsesIt}</p>
                <p className="detail-support">{detail.whyDoesItExist}</p>
              </>
            </DetailSection>
            <DetailSection title="Where it appears" icon={<FileCode2 />}>
              <p>{detail.whereItAppears}</p>
              <div className="source-links">
                {detail.relevantFiles.map((x) => (
                  <a
                    key={x}
                    href={`${record.meta.htmlUrl}/blob/${record.commitSha}/${x}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <FileCode2 size={13} /> {x} <ExternalLink size={12} />
                  </a>
                ))}
              </div>
            </DetailSection>
            {detail.codeSnippet && (
              <DetailSection title="Example from the repo" icon={<Code2 />}>
                <div className="code-block">
                  <div>
                    <span>{detail.codeSnippet.path}</span>
                    <CopyButton value={detail.codeSnippet.code} label="Copy" />
                  </div>
                  <pre>
                    <code>{detail.codeSnippet.code}</code>
                  </pre>
                </div>
              </DetailSection>
            )}
            <div className="misconception">
              <AlertTriangle />
              <div>
                <h3>Common mistake</h3>
                <p>{detail.commonMisconception}</p>
              </div>
            </div>
            <div className="comprehension">
              <CheckCircle2 />
              <div>
                <h3>Quick check</h3>
                <p>{detail.comprehensionQuestion}</p>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
function DetailSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="detail-section">
      <div className="detail-section-title">
        {icon}
        <h2>{title}</h2>
      </div>
      {typeof children === "string" ? <p>{children}</p> : children}
    </section>
  );
}

function MessageBody({ content }: { content: string }) {
  const blocks = content.split("```");
  return (
    <div className="message-content">
      {blocks.map((block, index) => {
        if (index % 2 === 0) return <span key={index}>{block}</span>;
        const newline = block.indexOf("\n");
        const code = newline === -1 ? block : block.slice(newline + 1);
        return (
          <pre key={index}>
            <code>{code.trimEnd()}</code>
          </pre>
        );
      })}
    </div>
  );
}

function Ask({ record }: { record: AnalysisRecord }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AppFailure | null>(null);
  const [rateLimit, setRateLimit] = useState<AppFailure | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [contextOpen, setContextOpen] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const send = async (value = question) => {
    const text = value.trim();
    if (!text || loading || cooldownSeconds > 0) return;
    const history = messages.map(({ role, content }) => ({ role, content }));
    setMessages((x) => [...x, { role: "user", content: text }]);
    setQuestion("");
    setError(null);
    setRateLimit(null);
    setLoading(true);
    try {
      const result = await askCodebase({
        data: {
          analysisId: record.analysisId,
          question: text,
          visitorId: anonymousVisitorId(),
          sessionId,
          history,
        },
      });
      if (result.ok) {
        setMessages((x) => [
          ...x,
          { role: "assistant", content: result.answer, referencedFiles: result.referencedFiles },
        ]);
        setSessionId(result.sessionId);
      } else if (result.code === "rate_limited") {
        setMessages((current) => {
          const last = current.at(-1);
          return last?.role === "user" && last.content === text ? current.slice(0, -1) : current;
        });
        setQuestion(text);
        setRateLimit(result);
        setCooldownSeconds(Math.max(1, result.retryAfterSeconds ?? 1));
      } else setError(result);
    } catch {
      setError(SERVER_UNAVAILABLE);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = window.setTimeout(() => {
      setCooldownSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [cooldownSeconds]);
  useEffect(() => {
    if (!messages.length && !loading) return;
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);
  useEffect(() => {
    const textarea = composer.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 128)}px`;
  }, [question]);
  return (
    <div className="chat-layout">
      <section className="chat-main">
        <PageHeading
          kicker="Ask"
          title="Ask the codebase"
          text="Answers are grounded in the repository files collected during analysis."
        />
        {messages.length === 0 && (
          <div className="chat-welcome">
            <span className="preview-icon">
              <BrainCircuit />
            </span>
            <div>
              <h2>
                Target: {record.meta.owner} / {record.meta.repo}
              </h2>
              <p>
                Ask about routes, data flow, dependencies, important files, or unfamiliar concepts.
              </p>
              <h3>Starter questions</h3>
              <div className="starter-questions">
                {QUESTIONS.map((x) => (
                  <button
                    type="button"
                    key={x}
                    disabled={loading || cooldownSeconds > 0}
                    onClick={() => void send(x)}
                  >
                    {x}
                    <ArrowRight size={14} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        <div className="messages">
          {messages.map((message, i) => (
            <article key={`${message.role}-${i}`} className={`message ${message.role}`}>
              <div className="message-role">
                {message.role === "user" ? (
                  "You"
                ) : (
                  <>
                    <Sparkles size={14} /> CodeCompass
                  </>
                )}
              </div>
              <MessageBody content={message.content} />
              {message.referencedFiles?.length ? (
                <div className="citations">
                  <span>Sources</span>
                  {message.referencedFiles.map((file) => (
                    <a
                      key={file}
                      href={`${record.meta.htmlUrl}/blob/${record.commitSha}/${file}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <FileCode2 size={13} />
                      {file}
                    </a>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
          {loading && (
            <article className="message assistant thinking">
              <LoaderCircle className="spin" />
              Tracing the answer through analyzed files…
            </article>
          )}
          {error && <ErrorNotice error={error} />}
          <div ref={bottom} />
        </div>
        {rateLimit && cooldownSeconds > 0 && (
          <div className="chat-rate-limit" role="status">
            <AlertTriangle size={16} />
            <span>{rateLimit.message}</span>
            <small>Retry in {formatRetryCountdown(cooldownSeconds)}</small>
          </div>
        )}
        <form
          className="chat-form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            ref={composer}
            rows={1}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question about this codebase…"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button
            className="chat-send"
            disabled={!question.trim() || loading || cooldownSeconds > 0}
            aria-label={
              loading
                ? "Sending question"
                : cooldownSeconds > 0
                  ? `Ask is temporarily limited. Retry in ${formatRetryCountdown(cooldownSeconds)}`
                  : "Send question"
            }
          >
            {loading ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}
          </button>
          <small>Grounded in {record.snapshot.analyzedFiles} analyzed files</small>
        </form>
      </section>
      <aside className="chat-context">
        <button
          className="chat-context-toggle"
          type="button"
          aria-expanded={contextOpen}
          aria-controls="chat-context-content"
          onClick={() => setContextOpen((value) => !value)}
        >
          Context
          <ChevronRight size={16} />
        </button>
        <div id="chat-context-content" className={contextOpen ? "context-open" : ""}>
          <section>
            <span className="eyebrow">Analysis context</span>
            <h3>{record.snapshot.analyzedFiles} analyzed files</h3>
            <p>Selected from {record.snapshot.totalFiles} repository files.</p>
          </section>
          <section>
            <h3>Top files</h3>
            <ul className="file-list">
              {record.analysis.importantFiles.slice(0, 5).map((file) => (
                <li key={file.path}>
                  <a
                    href={`${record.meta.htmlUrl}/blob/${record.commitSha}/${file.path}`}
                    target="_blank"
                    rel="noreferrer"
                    title={file.path}
                  >
                    <FileCode2 />
                    <span>{file.path}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3>Grounding rules</h3>
            <p>Answers cite only collected files and identify missing context.</p>
          </section>
        </div>
      </aside>
    </div>
  );
}

function updateRepoUrl(meta: RepoMeta, view: View) {
  const url = new URL(window.location.href);
  url.searchParams.set("repo", `${meta.owner}/${meta.repo}`);
  url.searchParams.set("view", view);
  window.history.pushState({}, "", url);
}

export function CodeCompassApp() {
  const [input, setInputState] = useState("");
  const [preview, setPreview] = useState<RepoMeta | null>(null);
  const [validationPhase, setValidationPhase] = useState<ValidationPhase>("idle");
  const validationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [record, setRecord] = useState<AnalysisRecord | null>(null);
  const [view, setViewState] = useState<View>("overview");
  const [appPhase, setAppPhase] = useState<AppPhase>("booting");
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<AppFailure | null>(null);
  const [stale, setStale] = useState(false);
  const [latestSha, setLatestSha] = useState<string | null>(null);
  const [usageNotice, setUsageNotice] = useState<AppFailure | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarPreferenceReady, setSidebarPreferenceReady] = useState(false);
  const analysisRequestActive = useRef(false);
  const setInput = (value: string) => {
    if (validationTimer.current) clearTimeout(validationTimer.current);
    setInputState(value);
    setPreview(null);
    setValidationPhase("idle");
    setError(null);
    setUsageNotice(null);
  };
  const setView = (next: View) => {
    setViewState(next);
    if (record) updateRepoUrl(record.meta, next);
  };
  const reset = () => {
    setRecord(null);
    setAppPhase("idle");
    setPreview(null);
    setValidationPhase("idle");
    setError(null);
    setUsageNotice(null);
    setStale(false);
    setLatestSha(null);
    const url = new URL(window.location.href);
    url.search = "";
    window.history.pushState({}, "", url);
  };
  const handlePreview = async () => {
    if (validationTimer.current) clearTimeout(validationTimer.current);
    setValidationPhase("validating");
    setError(null);
    try {
      const result = await previewRepository({ data: { input } });
      if (result.ok) {
        setPreview(result.meta);
        setValidationPhase("found");
        validationTimer.current = setTimeout(() => setValidationPhase("ready"), 900);
      } else {
        setValidationPhase("idle");
        setError(result);
      }
    } catch {
      setValidationPhase("idle");
      setError(SERVER_UNAVAILABLE);
    }
  };
  const startAnalysis = async (force = false) => {
    if ((!input.trim() && !record) || analysisRequestActive.current) return;
    analysisRequestActive.current = true;
    const target = record ? `${record.meta.owner}/${record.meta.repo}` : input;
    const stopWithError = (failure: AppFailure) => {
      if (failure.code === "rate_limited" && record) {
        setError(null);
        setUsageNotice(failure);
        setAppPhase("ready");
        return;
      }
      setError(failure);
      if (!record) setAppPhase("idle");
    };
    setAppPhase("analyzing");
    setError(null);
    setUsageNotice(null);
    setStage(0);
    const visitorId = anonymousVisitorId();
    try {
      const resolved = await resolveRepository({ data: { input: target } });
      if (!resolved.ok) {
        stopWithError(resolved);
        return;
      }
      setStage(1);
      if (resolved.cachedAnalysisId && !force) {
        const loaded = await loadAnalysis({
          data: { owner: resolved.meta.owner, repo: resolved.meta.repo, checkFresh: false },
        });
        if (!loaded.ok) {
          stopWithError(loaded);
          return;
        }
        finishLoad(loaded.record, resolved.commit.sha, false);
        return;
      }
      if (resolved.staleCommitSha && !force) {
        const loaded = await loadAnalysis({
          data: { owner: resolved.meta.owner, repo: resolved.meta.repo, checkFresh: false },
        });
        if (loaded.ok) {
          finishLoad(loaded.record, resolved.commit.sha, true);
          return;
        }
      }
      const collected = await collectContext({
        data: { repositoryId: resolved.repositoryId, commitSha: resolved.commit.sha, force },
      });
      if (!collected.ok) {
        stopWithError(collected);
        return;
      }
      setStage(4);
      const analyzed = await runAnalysis({
        data: { analysisId: collected.analysisId, visitorId, force },
      });
      if (!analyzed.ok) {
        stopWithError(analyzed);
        return;
      }
      setStage(6);
      finishLoad(
        {
          analysisId: collected.analysisId,
          repositoryId: resolved.repositoryId,
          commitSha: resolved.commit.sha,
          status: "complete",
          cached: false,
          meta: resolved.meta,
          snapshot: collected.snapshot,
          analysis: analyzed.analysis,
          createdAt: new Date().toISOString(),
        },
        resolved.commit.sha,
        false,
      );
    } catch {
      stopWithError(SERVER_UNAVAILABLE);
    } finally {
      analysisRequestActive.current = false;
    }
  };
  const finishLoad = (next: AnalysisRecord, sha: string | null, isStale: boolean) => {
    setRecord(next);
    setInputState(`${next.meta.owner}/${next.meta.repo}`);
    setLatestSha(sha);
    setStale(isStale);
    setAppPhase("ready");
    setViewState("overview");
    updateRepoUrl(next.meta, "overview");
  };
  useEffect(() => {
    const url = new URL(window.location.href);
    const repo = url.searchParams.get("repo");
    const requested = url.searchParams.get("view") as View | null;
    if (requested && VIEWS.some((x) => x.id === requested)) setViewState(requested);
    if (!repo) {
      setAppPhase("idle");
      return;
    }
    const [owner, name] = repo.split("/");
    if (!owner || !name) {
      setError({ code: "invalid_input", message: "Enter a repository as owner/repo." });
      setAppPhase("idle");
      return;
    }
    setInputState(`${owner}/${name}`);
    setAppPhase("restoring");
    void loadAnalysis({ data: { owner, repo: name, checkFresh: true } })
      .then((result) => {
        if (result.ok) {
          setRecord(result.record);
          setPreview(result.record.meta);
          setLatestSha(result.latestCommitSha);
          setStale(
            Boolean(result.latestCommitSha && result.latestCommitSha !== result.record.commitSha),
          );
          setAppPhase("ready");
        } else {
          setError(result);
        }
      })
      .catch(() => setError(SERVER_UNAVAILABLE));
  }, []);
  useEffect(
    () => () => {
      if (validationTimer.current) clearTimeout(validationTimer.current);
    },
    [],
  );
  useEffect(() => {
    setSidebarCollapsed(window.localStorage.getItem("codecompass-sidebar-collapsed") === "true");
    setSidebarPreferenceReady(true);
  }, []);
  useEffect(() => {
    if (!sidebarPreferenceReady) return;
    window.localStorage.setItem("codecompass-sidebar-collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed, sidebarPreferenceReady]);
  if ((appPhase === "booting" || appPhase === "restoring") && !record)
    return <RestorationState input={input || undefined} error={error} onReset={reset} />;
  if (!record && appPhase === "idle")
    return (
      <Landing
        input={input}
        setInput={setInput}
        preview={preview}
        validationPhase={validationPhase}
        error={error}
        onPreview={() => void handlePreview()}
        onAnalyze={() => void startAnalysis()}
      />
    );
  if (appPhase === "analyzing")
    return (
      <AnalysisProgress
        input={record ? `${record.meta.owner}/${record.meta.repo}` : input}
        stage={stage}
        error={error}
        onRetry={() => void startAnalysis(Boolean(record))}
        onCancel={() => {
          setAppPhase(record ? "ready" : "idle");
          setError(null);
          if (!record) {
            setPreview(null);
            setValidationPhase("idle");
          }
        }}
      />
    );
  if (!record) return null;
  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <RepositoryHeader
        record={record}
        stale={stale}
        onMenu={() => setDrawerOpen(true)}
        onSwitch={reset}
        onReanalyze={() => void startAnalysis(true)}
      />
      <Sidebar
        view={view}
        onView={setView}
        onSwitch={reset}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
      />
      <main className="app-content">
        <RepoBanner
          record={record}
          stale={stale}
          latestSha={latestSha}
          onReanalyze={() => void startAnalysis(true)}
        />
        {usageNotice && (
          <div className="usage-notice" role="status">
            <AlertTriangle size={16} />
            <span>{usageNotice.message}</span>
            <button type="button" onClick={() => setUsageNotice(null)} aria-label="Dismiss message">
              <X size={15} />
            </button>
          </div>
        )}
        {view === "overview" && <Overview record={record} onView={setView} />}
        {view === "architecture" && <Architecture layers={record.analysis.architecture} />}
        {view === "start" && <StartHere record={record} />}
        {view === "concepts" && <Concepts record={record} />}
        {view === "ask" && <Ask record={record} />}
      </main>
    </div>
  );
}
