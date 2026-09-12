import {
  AlertTriangle,
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
type AppFailure = { code: string; message: string };
type ChatMessage = { role: "user" | "assistant"; content: string; referencedFiles?: string[] };
type ValidationPhase = "idle" | "validating" | "found" | "ready";
const VIEWS: { id: View; label: string; icon: typeof Boxes }[] = [
  { id: "overview", label: "Overview", icon: Boxes },
  { id: "architecture", label: "Architecture", icon: Network },
  { id: "start", label: "Start Here", icon: BookOpen },
  { id: "concepts", label: "Concepts to Learn", icon: BrainCircuit },
  { id: "ask", label: "Ask Codebase", icon: MessageSquareText },
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

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Sparkles size={17} />
      </span>
      {!compact && <span>CodeCompass</span>}
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
function difficultyClass(value: Difficulty) {
  return `difficulty difficulty-${value}`;
}

function CopyButton({ value, label = "Copy path" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="quiet-button"
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? "Copied" : label}
    </button>
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
      <div className="topbar-brand">
        <Logo />
      </div>
      <button className="repo-chip" type="button" onClick={onSwitch}>
        <FolderGit2 size={15} />
        <span>
          {record.meta.owner} / <b>{record.meta.repo}</b>
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
}: {
  view: View;
  onView: (view: View) => void;
  onSwitch: () => void;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <>
      <button
        className={`drawer-backdrop ${open ? "shown" : ""}`}
        onClick={onClose}
        aria-label="Close navigation"
      />
      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <div className="drawer-heading">
          <Logo />
          <button type="button" onClick={onClose}>
            <PanelLeftClose />
          </button>
        </div>
        <p className="eyebrow sidebar-label">Architecture core</p>
        <nav>
          {VIEWS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={view === item.id ? "active" : ""}
                onClick={() => {
                  onView(item.id);
                  onClose();
                }}
              >
                <Icon size={17} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-divider" />
        <p className="eyebrow sidebar-label">Utilities</p>
        <button type="button" className="utility-link" onClick={onSwitch}>
          <RefreshCw size={16} /> Switch repository
        </button>
        <div className="sidebar-foot">
          <div className="tiny-status">
            <span>Analysis engine</span>
            <b>Ready</b>
          </div>
          <div className="health-bar">
            <span />
          </div>
          <small>Public repositories only</small>
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
        <div className="hero-kicker">
          <Sparkles size={14} /> Intelligent codebase onboarding
        </div>
        <h1>
          Understand any codebase
          <br />
          <span>without feeling lost</span>
        </h1>
        <p>
          Paste a public GitHub repository and get a grounded map of what it does, how the pieces
          connect, where to start reading, and what to learn.
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
            <span>Try an open-source repository:</span>
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
            <span className="eyebrow">System workflow</span>
            <h2>How CodeCompass decodes software</h2>
          </div>
        </div>
        <div className="workflow-grid">
          <article>
            <span className="stage-tag">Stage 01</span>
            <Search />
            <h3>Validate the repository</h3>
            <p>Confirm the public repository and inspect its latest commit before work begins.</p>
          </article>
          <article>
            <span className="stage-tag blue">Stage 02</span>
            <Network />
            <h3>Map the architecture</h3>
            <p>Read high-signal files and connect the repository’s actual layers and concepts.</p>
          </article>
          <article>
            <span className="stage-tag amber">Stage 03</span>
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
  const progress = Math.round(((Math.max(stage, 0) + 0.45) / STAGES.length) * 100);
  return (
    <main className="analysis-page">
      <div className="analysis-top">
        <Logo />
        <span className="engine-badge">
          <Circle size={8} fill="currentColor" /> Engine running
        </span>
      </div>
      <section className="analysis-card panel-glow">
        <div>
          <span className="eyebrow">Target repository inspection</span>
          <h1>{input}</h1>
          <p>
            Building a trustworthy mental model from repository metadata and selected source files.
          </p>
        </div>
        <div className="progress-card">
          <div>
            <span>Pipeline completion</span>
            <strong>{Math.min(progress, 96)}%</strong>
          </div>
          <div className="progress-track">
            <span style={{ width: `${Math.min(progress, 96)}%` }} />
          </div>
          <small>
            Stage {Math.max(1, stage + 1)} of {STAGES.length}
          </small>
        </div>
      </section>
      {error ? (
        <ErrorNotice error={error} onRetry={onRetry} />
      ) : (
        <section className="stage-list">
          <div className="section-heading">
            <h2>Analysis stages</h2>
            <span className="eyebrow">Grounded pipeline</span>
          </div>
          {STAGES.map((name, i) => (
            <article key={name} className={i === stage ? "current" : i < stage ? "done" : "queued"}>
              <span className="stage-state">
                {i < stage ? (
                  <Check size={18} />
                ) : i === stage ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <Circle size={18} />
                )}
              </span>
              <div>
                <h3>{name}</h3>
                <p>
                  {i < stage
                    ? "Completed successfully"
                    : i === stage
                      ? "Working with the repository’s real data…"
                      : "Waiting for the previous stage"}
                </p>
              </div>
              <span className="stage-label">
                {i < stage ? "Done" : i === stage ? "In progress" : "Queued"}
              </span>
            </article>
          ))}
        </section>
      )}
      <button className="cancel-button" type="button" onClick={onCancel}>
        <X size={16} /> Return to repository input
      </button>
    </main>
  );
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
  return (
    <div className="view-stack">
      <section className="overview-hero panel-glow">
        <div>
          <span className="eyebrow">
            <Sparkles size={13} /> Junior developer plain-English digest
          </span>
          <h1>What this project actually does</h1>
          <p>
            <b>{meta.repo}</b> {analysis.summary.whatItDoes}
          </p>
          <div className="tag-row">
            <span>{analysis.summary.projectType}</span>
            <span>{analysis.summary.whoItsFor}</span>
          </div>
        </div>
        <div className="repo-facts">
          <div>
            <span>Primary language</span>
            <b>{meta.language || "Mixed"}</b>
          </div>
          <div>
            <span>Default branch</span>
            <b>{meta.defaultBranch}</b>
          </div>
          <div>
            <span>Commit</span>
            <b>{shortSha(record.commitSha)}</b>
          </div>
          <div>
            <span>Cache</span>
            <b>{record.cached ? "Loaded" : "Fresh"}</b>
          </div>
        </div>
      </section>
      <section className="metrics-grid">
        <Metric
          icon={<FolderGit2 />}
          label="Repository scale"
          value={formatNumber(snapshot.totalFiles)}
          note={`files across ${formatNumber(snapshot.directories)} directories`}
        />
        <Metric
          icon={<Layers3 />}
          label="Architecture"
          value={analysis.architecture.length}
          note="repository-specific layers"
        />
        <Metric
          icon={<FileCode2 />}
          label="Reading onramp"
          value={analysis.importantFiles.length}
          note="ranked essential files"
        />
        <Metric
          icon={<BrainCircuit />}
          label="Mental models"
          value={analysis.conceptsToLearn.length}
          note="concepts in learning order"
        />
      </section>
      <section className="mental-model panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Mental model</span>
            <h2>{analysis.summary.beginnerMentalModel || "How the repository fits together"}</h2>
          </div>
        </div>
        <div className="layer-strip">
          {analysis.architecture.slice(0, 5).map((layer, i) => (
            <div key={layer.id}>
              <span>{String(i + 1).padStart(2, "0")}</span>
              <b>{layer.name}</b>
              <p>{layer.description}</p>
            </div>
          ))}
        </div>
      </section>
      <section>
        <div className="section-heading">
          <div>
            <span className="eyebrow">Ecosystem</span>
            <h2>Technology stack and roles</h2>
          </div>
          <span>{analysis.technologies.length} technologies</span>
        </div>
        <div className="tech-grid">
          {analysis.technologies.map((tech) => (
            <article key={`${tech.name}-${tech.category}`}>
              <div>
                <Code2 size={17} />
                <h3>{tech.name}</h3>
              </div>
              <span>{tech.category}</span>
              <p>{tech.roleInRepository}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="cta-grid">
        <button type="button" onClick={() => onView("start")}>
          <BookOpen />
          <span>
            <b>Start with the essential files</b>
            <small>Follow the curated reading order</small>
          </span>
          <ArrowRight />
        </button>
        <button type="button" onClick={() => onView("architecture")}>
          <Network />
          <span>
            <b>Explore the architecture map</b>
            <small>Inspect how layers connect</small>
          </span>
          <ArrowRight />
        </button>
      </section>
    </div>
  );
}
function Metric({
  icon,
  label,
  value,
  note,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  note: string;
}) {
  return (
    <article>
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{note}</p>
    </article>
  );
}

function Architecture({ layers }: { layers: ArchitectureLayer[] }) {
  const [selectedId, setSelectedId] = useState(layers[0]?.id ?? "");
  const selected = layers.find((x) => x.id === selectedId) ?? layers[0];
  return (
    <div className="architecture-layout">
      <section className="architecture-main">
        <PageHeading
          kicker="Interactive architecture map"
          title="How the pieces connect"
          text="Select a repository layer to inspect its responsibility, files, concepts, and connections."
        />
        <div className="layer-map">
          {layers.map((layer, i) => (
            <div key={layer.id} className="layer-node-wrap">
              <button
                type="button"
                className={`layer-node ${selected?.id === layer.id ? "selected" : ""}`}
                onClick={() => setSelectedId(layer.id)}
              >
                <span className="layer-number">Layer {String(i + 1).padStart(2, "0")}</span>
                <div>
                  <Layers3 />
                  <h2>{layer.name}</h2>
                </div>
                <p>{layer.description}</p>
                <div className="tag-row">
                  {layer.relatedFiles.slice(0, 3).map((file) => (
                    <span key={file} title={file}>
                      {file}
                    </span>
                  ))}
                </div>
                <ChevronRight />
              </button>
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
        <aside className="inspector">
          <span className="eyebrow">Selected layer inspector</span>
          <h2>{selected.name}</h2>
          <section>
            <h3>Why this matters</h3>
            <p>{selected.description}</p>
          </section>
          <section>
            <h3>Connected layers</h3>
            <div className="tag-row">
              {selected.connectsTo.length ? (
                selected.connectsTo.map((id) => (
                  <button type="button" key={id} onClick={() => setSelectedId(id)}>
                    {layers.find((l) => l.id === id)?.name ?? id}
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
              {selected.relatedFiles.map((file) => (
                <li key={file}>
                  <FileCode2 />
                  <span title={file}>{file}</span>
                </li>
              ))}
            </ul>
          </section>
          {selected.concepts?.length ? (
            <section>
              <h3>Concepts to master</h3>
              <div className="tag-row">
                {selected.concepts.map((x) => (
                  <span key={x}>{x}</span>
                ))}
              </div>
            </section>
          ) : null}
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

function StartHere({ record }: { record: AnalysisRecord }) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const files = record.analysis.importantFiles;
  return (
    <div className="view-stack">
      <section className="page-hero panel-glow">
        <span className="eyebrow">Curated onboarding order</span>
        <h1>Start here: {files.length} files that explain this project</h1>
        <p>Read these in order to move from entry points to core behavior and data boundaries.</p>
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
            <span className="eyebrow">Step-by-step traversal</span>
            <h2>Essential files</h2>
          </div>
          <CopyButton value={files.map((x) => x.path).join("\n")} label="Copy reading plan" />
        </div>
        <div className="reading-list">
          {files.map((file) => (
            <article key={file.path} className={done.has(file.path) ? "file-done" : ""}>
              <button
                type="button"
                className="completion"
                onClick={() =>
                  setDone((current) => {
                    const next = new Set(current);
                    if (next.has(file.path)) next.delete(file.path);
                    else next.add(file.path);
                    return next;
                  })
                }
              >
                {done.has(file.path) ? <Check /> : <Circle />}
              </button>
              <span className="file-rank">{String(file.recommendedOrder).padStart(2, "0")}</span>
              <div className="file-copy">
                <div className="file-title">
                  <h3 title={file.path}>{file.path}</h3>
                  <span>{file.category}</span>
                  <span className={difficultyClass(file.difficulty)}>{file.difficulty}</span>
                </div>
                <p>{file.whyItMatters}</p>
                <div className="beginner-note">
                  <Sparkles size={14} />
                  <span>{file.beginnerExplanation}</span>
                </div>
                <div className="file-actions">
                  <div className="tag-row">
                    {file.concepts.map((x) => (
                      <span key={x}>{x}</span>
                    ))}
                  </div>
                  <CopyButton value={file.path} />
                  <a
                    className="quiet-button"
                    href={`${record.meta.htmlUrl}/blob/${record.commitSha}/${file.path}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={14} />
                    GitHub
                  </a>
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
  const requestId = useRef(0);
  const load = useCallback(
    async (concept: ConceptToLearn) => {
      const currentRequest = ++requestId.current;
      setSelectedName(concept.name);
      setDetail(null);
      setError(null);
      setLoading(true);
      try {
        const result = await explainConcept({
          data: { analysisId: record.analysisId, conceptName: concept.name },
        });
        if (currentRequest !== requestId.current) return;
        if (result.ok) setDetail(result.detail);
        else setError(result);
      } catch {
        if (currentRequest === requestId.current) setError(SERVER_UNAVAILABLE);
      } finally {
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
  return (
    <div className="concept-layout">
      <section className="concept-nav">
        <PageHeading
          kicker="Curated mental graph"
          title="Repository curriculum"
          text="Learn concepts in dependency order, grounded in this codebase."
        />
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
                <div className="tag-row">
                  <span className={difficultyClass(concept.difficulty)}>{concept.difficulty}</span>
                  {concept.prerequisites.slice(0, 1).map((x) => (
                    <span key={x}>Prereq: {x}</span>
                  ))}
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>
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
              {detail.whatIsIt}
            </DetailSection>
            <DetailSection title="Why it exists" icon={<Zap />}>
              {detail.whyDoesItExist}
            </DetailSection>
            <DetailSection title="Why this repository uses it" icon={<Network />}>
              {detail.whyThisRepoUsesIt}
            </DetailSection>
            <DetailSection title="Where it appears" icon={<FileCode2 />}>
              <p>{detail.whereItAppears}</p>
              <div className="tag-row">
                {detail.relevantFiles.map((x) => (
                  <span key={x}>{x}</span>
                ))}
              </div>
              {detail.codeSnippet && (
                <div className="code-block">
                  <div>
                    <span>{detail.codeSnippet.path}</span>
                    <CopyButton value={detail.codeSnippet.code} label="Copy" />
                  </div>
                  <pre>
                    <code>{detail.codeSnippet.code}</code>
                  </pre>
                </div>
              )}
            </DetailSection>
            <DetailSection title="Plain-English version" icon={<Sparkles />}>
              {detail.beginnerExplanation}
            </DetailSection>
            <div className="misconception">
              <AlertTriangle />
              <div>
                <h3>Common misconception</h3>
                <p>{detail.commonMisconception}</p>
              </div>
            </div>
            <div className="comprehension">
              <CheckCircle2 />
              <div>
                <h3>Quick comprehension check</h3>
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
  const bottom = useRef<HTMLDivElement>(null);
  const send = async (value = question) => {
    const text = value.trim();
    if (!text || loading) return;
    const history = messages.map(({ role, content }) => ({ role, content }));
    setMessages((x) => [...x, { role: "user", content: text }]);
    setQuestion("");
    setError(null);
    setLoading(true);
    try {
      const result = await askCodebase({
        data: { analysisId: record.analysisId, question: text, sessionId, history },
      });
      if (result.ok) {
        setMessages((x) => [
          ...x,
          { role: "assistant", content: result.answer, referencedFiles: result.referencedFiles },
        ]);
        setSessionId(result.sessionId);
      } else setError(result);
    } catch {
      setError(SERVER_UNAVAILABLE);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), [messages, loading]);
  return (
    <div className="chat-layout">
      <section className="chat-main">
        <PageHeading
          kicker="Grounded repository chat"
          title="Ask the Codebase"
          text="Answers use only files selected and read during analysis."
        />
        {messages.length === 0 && (
          <div className="chat-welcome panel-glow">
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
              <span className="eyebrow">Starter questions</span>
              <div className="starter-questions">
                {QUESTIONS.map((x) => (
                  <button type="button" key={x} onClick={() => void send(x)}>
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
                    <Sparkles size={14} /> CodeCompass AI
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
        <form
          className="chat-form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about routes, data flow, dependencies, or files…"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button className="primary-button" disabled={!question.trim() || loading}>
            <Send size={18} />
          </button>
          <small>
            Grounded in {record.snapshot.analyzedFiles} selected files · answers identify missing
            context
          </small>
        </form>
      </section>
      <aside className="chat-context">
        <section>
          <span className="eyebrow">Analysis context</span>
          <h3>{record.snapshot.totalFiles} repository files</h3>
          <p>{record.snapshot.analyzedFiles} high-signal files were read in depth.</p>
        </section>
        <section>
          <h3>Top files</h3>
          <ul className="file-list">
            {record.analysis.importantFiles.slice(0, 5).map((x) => (
              <li key={x.path}>
                <FileCode2 />
                <span>{x.path}</span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3>Grounding rules</h3>
          <p>
            CodeCompass cites only files included in the context and calls out missing evidence.
          </p>
        </section>
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
  const [analyzing, setAnalyzing] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<AppFailure | null>(null);
  const [stale, setStale] = useState(false);
  const [latestSha, setLatestSha] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const setInput = (value: string) => {
    if (validationTimer.current) clearTimeout(validationTimer.current);
    setInputState(value);
    setPreview(null);
    setValidationPhase("idle");
    setError(null);
  };
  const setView = (next: View) => {
    setViewState(next);
    if (record) updateRepoUrl(record.meta, next);
  };
  const reset = () => {
    setRecord(null);
    setAnalyzing(false);
    setPreview(null);
    setValidationPhase("idle");
    setError(null);
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
    if (!input.trim() && !record) return;
    const target = record ? `${record.meta.owner}/${record.meta.repo}` : input;
    const stopWithError = (failure: AppFailure) => {
      setError(failure);
      if (!record) setAnalyzing(false);
    };
    setAnalyzing(true);
    setError(null);
    setStage(0);
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
        data: { repositoryId: resolved.repositoryId, commitSha: resolved.commit.sha },
      });
      if (!collected.ok) {
        stopWithError(collected);
        return;
      }
      setStage(4);
      const analyzed = await runAnalysis({ data: { analysisId: collected.analysisId } });
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
    }
  };
  const finishLoad = (next: AnalysisRecord, sha: string | null, isStale: boolean) => {
    setRecord(next);
    setInputState(`${next.meta.owner}/${next.meta.repo}`);
    setLatestSha(sha);
    setStale(isStale);
    setAnalyzing(false);
    setViewState("overview");
    updateRepoUrl(next.meta, "overview");
  };
  useEffect(() => {
    const url = new URL(window.location.href);
    const repo = url.searchParams.get("repo");
    const requested = url.searchParams.get("view") as View | null;
    if (requested && VIEWS.some((x) => x.id === requested)) setViewState(requested);
    if (!repo) return;
    const [owner, name] = repo.split("/");
    if (!owner || !name) return;
    setInputState(`${owner}/${name}`);
    setAnalyzing(true);
    void loadAnalysis({ data: { owner, repo: name, checkFresh: true } })
      .then((result) => {
        if (result.ok) {
          setRecord(result.record);
          setPreview(result.record.meta);
          setLatestSha(result.latestCommitSha);
          setStale(
            Boolean(result.latestCommitSha && result.latestCommitSha !== result.record.commitSha),
          );
        } else setError(result);
      })
      .catch(() => setError(SERVER_UNAVAILABLE))
      .finally(() => setAnalyzing(false));
  }, []);
  useEffect(
    () => () => {
      if (validationTimer.current) clearTimeout(validationTimer.current);
    },
    [],
  );
  if (!record && !analyzing)
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
  if (analyzing)
    return (
      <AnalysisProgress
        input={record ? `${record.meta.owner}/${record.meta.repo}` : input}
        stage={stage}
        error={error}
        onRetry={() => void startAnalysis(Boolean(record))}
        onCancel={() => {
          setAnalyzing(false);
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
    <div className="app-shell">
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
      />
      <main className="app-content">
        <RepoBanner
          record={record}
          stale={stale}
          latestSha={latestSha}
          onReanalyze={() => void startAnalysis(true)}
        />
        {view === "overview" && <Overview record={record} onView={setView} />}
        {view === "architecture" && <Architecture layers={record.analysis.architecture} />}
        {view === "start" && <StartHere record={record} />}
        {view === "concepts" && <Concepts record={record} />}
        {view === "ask" && <Ask record={record} />}
      </main>
    </div>
  );
}
