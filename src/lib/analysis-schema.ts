export type Difficulty = "beginner" | "intermediate" | "advanced";

export interface AnalysisSummary {
  whatItDoes: string;
  whoItsFor: string;
  projectType: string;
  beginnerMentalModel: string;
}

export interface TechnologyItem {
  name: string;
  category: string;
  roleInRepository: string;
}

export interface ArchitectureLayer {
  id: string;
  name: string;
  description: string;
  relatedFiles: string[];
  connectsTo: string[];
  concepts?: string[];
}

export interface ImportantFile {
  path: string;
  filename: string;
  category: string;
  whyItMatters: string;
  beginnerExplanation: string;
  difficulty: Difficulty;
  recommendedOrder: number;
  concepts: string[];
}

export interface ConceptToLearn {
  name: string;
  whyItMattersHere: string;
  prerequisites: string[];
  relatedFiles: string[];
  difficulty: Difficulty;
  recommendedOrder: number;
}

export interface RepoAnalysis {
  summary: AnalysisSummary;
  technologies: TechnologyItem[];
  architecture: ArchitectureLayer[];
  importantFiles: ImportantFile[];
  conceptsToLearn: ConceptToLearn[];
}

export interface ConceptDetail {
  name: string;
  whatIsIt: string;
  whyDoesItExist: string;
  whyThisRepoUsesIt: string;
  whereItAppears: string;
  relevantFiles: string[];
  codeSnippet: { path: string; code: string } | null;
  beginnerExplanation: string;
  commonMisconception: string;
  comprehensionQuestion: string;
}

export interface RepoMeta {
  owner: string;
  repo: string;
  description: string | null;
  htmlUrl: string;
  defaultBranch: string;
  language: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  license: string | null;
  topics: string[];
  pushedAt: string | null;
  sizeKb: number;
  archived: boolean;
}

export interface RepoSnapshot {
  totalFiles: number;
  directories: number;
  analyzedFiles: number;
  manifests: string[];
  topDirectories: { name: string; files: number }[];
}

export interface AnalysisRecord {
  analysisId: string;
  repositoryId: string;
  commitSha: string;
  status: string;
  cached: boolean;
  meta: RepoMeta;
  snapshot: RepoSnapshot;
  analysis: RepoAnalysis;
  createdAt: string;
}

const DIFFICULTIES: Difficulty[] = ["beginner", "intermediate", "advanced"];

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 24) : [];
}
function difficulty(v: unknown): Difficulty {
  const s = str(v).toLowerCase() as Difficulty;
  return DIFFICULTIES.includes(s) ? s : "intermediate";
}
function slug(s: string, i: number) {
  const base = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return base || `layer-${i + 1}`;
}

/** Validates + normalizes untrusted model output into a stable shape. */
export function validateAnalysis(raw: unknown): RepoAnalysis {
  if (!raw || typeof raw !== "object") throw new Error("Analysis response was not an object");
  const r = raw as any;
  const s = (r.summary ?? {}) as any;

  const summary: AnalysisSummary = {
    whatItDoes: str(s.whatItDoes),
    whoItsFor: str(s.whoItsFor),
    projectType: str(s.projectType),
    beginnerMentalModel: str(s.beginnerMentalModel),
  };
  if (!summary.whatItDoes) throw new Error("Analysis is missing a project summary");

  const technologies: TechnologyItem[] = ((Array.isArray(r.technologies) ? r.technologies : []) as any[])
    .map((t) => {
      const o = (t ?? {}) as any;
      return {
        name: str(o.name),
        category: str(o.category, "Other"),
        roleInRepository: str(o.roleInRepository),
      };
    })
    .filter((t) => t.name)
    .slice(0, 40);

  const architecture: ArchitectureLayer[] = ((Array.isArray(r.architecture) ? r.architecture : []) as any[])
    .map((a, i) => {
      const o = (a ?? {}) as any;
      const name = str(o.name);
      return {
        id: str(o.id) || slug(name, i),
        name,
        description: str(o.description),
        relatedFiles: strArray(o.relatedFiles),
        connectsTo: strArray(o.connectsTo),
        concepts: strArray(o.concepts),
      };
    })
    .filter((a) => a.name)
    .slice(0, 12);

  const importantFiles: ImportantFile[] = ((Array.isArray(r.importantFiles) ? r.importantFiles : []) as any[])
    .map((f, i) => {
      const o = (f ?? {}) as any;
      const path = str(o.path);
      return {
        path,
        filename: str(o.filename) || path.split("/").pop() || path,
        category: str(o.category, "Source"),
        whyItMatters: str(o.whyItMatters),
        beginnerExplanation: str(o.beginnerExplanation),
        difficulty: difficulty(o.difficulty),
        recommendedOrder: typeof o.recommendedOrder === "number" ? o.recommendedOrder : i + 1,
        concepts: strArray(o.concepts),
      };
    })
    .filter((f) => f.path)
    .sort((a, b) => a.recommendedOrder - b.recommendedOrder)
    .slice(0, 15);

  const conceptsToLearn: ConceptToLearn[] = (
    (Array.isArray(r.conceptsToLearn) ? r.conceptsToLearn : []) as any[]
  )
    .map((c, i) => {
      const o = (c ?? {}) as any;
      return {
        name: str(o.name),
        whyItMattersHere: str(o.whyItMattersHere),
        prerequisites: strArray(o.prerequisites),
        relatedFiles: strArray(o.relatedFiles),
        difficulty: difficulty(o.difficulty),
        recommendedOrder: typeof o.recommendedOrder === "number" ? o.recommendedOrder : i + 1,
      };
    })
    .filter((c) => c.name)
    .sort((a, b) => a.recommendedOrder - b.recommendedOrder)
    .slice(0, 12);

  if (!architecture.length) throw new Error("Analysis is missing architecture layers");
  if (!importantFiles.length) throw new Error("Analysis is missing important files");

  return { summary, technologies, architecture, importantFiles, conceptsToLearn };
}

export function validateConceptDetail(raw: unknown, name: string): ConceptDetail {
  if (!raw || typeof raw !== "object") throw new Error("Concept response was not an object");
  const o = raw as any;
  const snip = (o.codeSnippet ?? null) as any | null;
  const detail: ConceptDetail = {
    name: str(o.name, name),
    whatIsIt: str(o.whatIsIt),
    whyDoesItExist: str(o.whyDoesItExist),
    whyThisRepoUsesIt: str(o.whyThisRepoUsesIt),
    whereItAppears: str(o.whereItAppears),
    relevantFiles: strArray(o.relevantFiles),
    codeSnippet:
      snip && str(snip.code)
        ? { path: str(snip.path, "unknown"), code: str(snip.code).slice(0, 4000) }
        : null,
    beginnerExplanation: str(o.beginnerExplanation),
    commonMisconception: str(o.commonMisconception),
    comprehensionQuestion: str(o.comprehensionQuestion),
  };
  if (!detail.whatIsIt) throw new Error("Concept explanation was incomplete");
  return detail;
}

export function parseRepoInput(input: string): { owner: string; repo: string } | null {
  const raw = (input || "").trim();
  if (!raw || raw.length > 300) return null;
  let candidate = raw;
  const urlMatch = raw.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i);
  if (urlMatch) candidate = urlMatch[1] ?? candidate;
  candidate = (candidate.replace(/^\/+/, "").replace(/\.git$/i, "").split(/[?#]/)[0]) ?? "";
  const parts = candidate.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0] ?? ""; const repo = parts[1] ?? "";
  const ok = /^[A-Za-z0-9-_.]{1,100}$/;
  if (!ok.test(owner) || !ok.test(repo)) return null;
  return { owner, repo };
}
