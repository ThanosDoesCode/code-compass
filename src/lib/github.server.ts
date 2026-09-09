import type { RepoMeta, RepoSnapshot } from "./analysis-schema";

const GH = "https://api.github.com";
const UA = "CodeCompass-Lovable";

export class AppError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function gh(path: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${GH}${path}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": UA },
    });
  } catch {
    throw new AppError("network", "We could not reach GitHub. Check your connection and retry.");
  }
  if (res.status === 404) {
    throw new AppError(
      "not_found",
      "That repository does not exist or is private. CodeCompass supports public repositories only.",
    );
  }
  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (remaining === "0") {
      throw new AppError(
        "rate_limit",
        "GitHub's hourly rate limit was reached. Please try again in a little while.",
      );
    }
    throw new AppError("forbidden", "GitHub refused this request. The repository may be private.");
  }
  if (!res.ok) {
    throw new AppError("github", `GitHub returned an unexpected error (${res.status}).`);
  }
  return res;
}

export async function fetchRepoMeta(owner: string, repo: string): Promise<RepoMeta> {
  const res = await gh(`/repos/${owner}/${repo}`);
  const d = (await res.json()) as any;
  if (d.private) throw new AppError("private", "This repository is private and cannot be analyzed.");
  return {
    owner: d.owner?.login ?? owner,
    repo: d.name ?? repo,
    description: d.description ?? null,
    htmlUrl: d.html_url ?? `https://github.com/${owner}/${repo}`,
    defaultBranch: d.default_branch ?? "main",
    language: d.language ?? null,
    stars: d.stargazers_count ?? 0,
    forks: d.forks_count ?? 0,
    openIssues: d.open_issues_count ?? 0,
    license: d.license?.spdx_id ?? null,
    topics: Array.isArray(d.topics) ? d.topics.slice(0, 12) : [],
    pushedAt: d.pushed_at ?? null,
    sizeKb: d.size ?? 0,
    archived: Boolean(d.archived),
  };
}

export async function fetchLatestCommit(owner: string, repo: string, branch: string) {
  const res = await gh(`/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`);
  const d = (await res.json()) as any;
  return {
    sha: String(d.sha ?? ""),
    message: String(d.commit?.message ?? "").slice(0, 200),
    date: d.commit?.author?.date ?? null,
    author: d.commit?.author?.name ?? null,
  };
}

export interface TreeEntry {
  path: string;
  size: number;
}

export async function fetchTree(owner: string, repo: string, sha: string) {
  const res = await gh(`/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`);
  const d = (await res.json()) as any;
  const entries: TreeEntry[] = (Array.isArray(d.tree) ? d.tree : [])
    .filter((n: any) => n.type === "blob" && typeof n.path === "string")
    .map((n: any) => ({ path: n.path as string, size: Number(n.size ?? 0) }));
  const dirs = new Set<string>(
    (Array.isArray(d.tree) ? d.tree : [])
      .filter((n: any) => n.type === "tree")
      .map((n: any) => n.path as string),
  );
  return { entries, directories: dirs, truncated: Boolean(d.truncated) };
}

const MAX_FILE_BYTES = 60_000;

export async function fetchFile(
  owner: string,
  repo: string,
  sha: string,
  path: string,
): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${path}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > MAX_FILE_BYTES) {
      return text.slice(0, MAX_FILE_BYTES) + "\n/* ...truncated by CodeCompass... */";
    }
    return text;
  } catch {
    return null;
  }
}

/* ----------------------- deterministic file selection ---------------------- */

export const MANIFEST_FILES = [
  "package.json",
  "pnpm-workspace.yaml",
  "requirements.txt",
  "pyproject.toml",
  "Pipfile",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Cargo.toml",
  "go.mod",
  "composer.json",
  "Gemfile",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "README.md",
  "readme.md",
  "README.rst",
  "tsconfig.json",
  ".env.example",
  "supabase/config.toml",
  "Makefile",
];

const MANIFEST_PATTERNS = [
  /^vite\.config\.[jt]sx?$/,
  /^next\.config\.(m?[jt]s)$/,
  /^nuxt\.config\.[jt]s$/,
  /^svelte\.config\.js$/,
  /^astro\.config\.m?[jt]s$/,
  /^angular\.json$/,
  /^tailwind\.config\.[jt]s$/,
  /^prisma\/schema\.prisma$/,
  /^manage\.py$/,
];

const IGNORE_DIRS = [
  "node_modules/",
  "dist/",
  "build/",
  "out/",
  "coverage/",
  "vendor/",
  ".git/",
  ".next/",
  ".nuxt/",
  "target/",
  "__pycache__/",
  ".venv/",
  "venv/",
  "docs/",
  "examples/",
  "example/",
  "fixtures/",
  "__snapshots__/",
  "public/",
  "static/",
  "assets/",
  "locales/",
  "i18n/",
];

const IGNORE_EXT =
  /\.(png|jpe?g|gif|svg|webp|ico|bmp|mp4|mov|avi|webm|mp3|wav|ogg|woff2?|ttf|eot|otf|pdf|zip|gz|tar|rar|7z|exe|dll|so|dylib|class|jar|wasm|bin|lock|snap|min\.js|min\.css|map)$/i;

const SOURCE_EXT =
  /\.(tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|rb|php|cs|swift|vue|svelte|astro|sql|prisma|graphql|ex|exs|scala|c|cc|cpp|h|hpp|sh)$/i;

const PRIORITY_DIRS: Record<string, number> = {
  src: 20,
  app: 22,
  pages: 18,
  routes: 22,
  api: 24,
  server: 22,
  services: 20,
  lib: 16,
  contexts: 16,
  models: 20,
  controllers: 20,
  supabase: 18,
  prisma: 20,
  middleware: 20,
  hooks: 10,
  store: 16,
  db: 18,
  config: 14,
  cmd: 18,
  internal: 14,
  core: 16,
};

const PRIORITY_NAMES: { re: RegExp; score: number; category: string }[] = [
  { re: /^(main|index|app|server|entry|__init__|_app|mod)\.[a-z]+$/i, score: 40, category: "Entry point" },
  { re: /(^|\/)(router|routes|routing)\.[a-z]+$/i, score: 36, category: "Routing" },
  { re: /(auth|session|login|jwt|oauth)/i, score: 34, category: "Authentication" },
  { re: /(middleware)/i, score: 30, category: "Middleware" },
  { re: /(schema|model|entity|migration)/i, score: 28, category: "Data model" },
  { re: /(client|db|database|supabase|prisma|orm|repository)/i, score: 26, category: "Data access" },
  { re: /(service|handler|controller|resolver|usecase)/i, score: 24, category: "Business logic" },
  { re: /(context|provider|store|state|reducer)/i, score: 20, category: "State" },
  { re: /(layout|root|shell|__root)/i, score: 22, category: "Layout" },
  { re: /(config|settings|env)/i, score: 14, category: "Configuration" },
];

function categoryFor(path: string): string {
  for (const p of PRIORITY_NAMES) if (p.re.test(path)) return p.category;
  return "Source";
}

export interface SelectedFile {
  path: string;
  category: string;
  content: string;
}

export function isManifest(path: string) {
  const base = path.split("/").pop() ?? path;
  return (
    MANIFEST_FILES.includes(path) ||
    MANIFEST_FILES.includes(base) ||
    MANIFEST_PATTERNS.some((re) => re.test(path)) ||
    MANIFEST_PATTERNS.some((re) => re.test(base))
  );
}

export function scoreFile(entry: TreeEntry): number {
  const { path, size } = entry;
  const lower = path.toLowerCase();
  if (IGNORE_DIRS.some((d) => lower.startsWith(d) || lower.includes(`/${d}`))) return -1;
  if (IGNORE_EXT.test(lower)) return -1;
  if (/\.(test|spec)\./.test(lower) || lower.includes("/tests/") || lower.startsWith("test/"))
    return -1;
  if (!SOURCE_EXT.test(lower)) return -1;
  if (size > MAX_FILE_BYTES || size < 30) return -1;

  let score = 10;
  const segments = path.split("/");
  for (const seg of segments.slice(0, -1)) {
    score += PRIORITY_DIRS[seg.toLowerCase()] ?? 0;
  }
  for (const p of PRIORITY_NAMES) if (p.re.test(path)) score += p.score;
  score -= Math.min(12, segments.length * 2);
  score -= Math.min(10, Math.floor(size / 8000));
  return score;
}

export function selectImportantPaths(entries: TreeEntry[], limit: number): TreeEntry[] {
  return entries
    .map((e) => ({ e, s: scoreFile(e) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.e);
}

export function buildSnapshot(
  entries: TreeEntry[],
  directories: Set<string>,
  manifests: string[],
  analyzedFiles: number,
): RepoSnapshot {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const top = e.path.includes("/") ? e.path.split("/")[0] : "(root)";
    counts.set(top, (counts.get(top) ?? 0) + 1);
  }
  const topDirectories = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, files]) => ({ name, files }));
  return {
    totalFiles: entries.length,
    directories: directories.size,
    analyzedFiles,
    manifests,
    topDirectories,
  };
}

/** Compact tree representation, capped so we never blow the context window. */
export function compactTree(entries: TreeEntry[], max = 500): string {
  const kept = entries
    .filter((e) => {
      const lower = e.path.toLowerCase();
      if (IGNORE_DIRS.some((d) => lower.startsWith(d) || lower.includes(`/${d}`))) return false;
      return !IGNORE_EXT.test(lower);
    })
    .slice(0, max);
  const extra = entries.length - kept.length;
  return kept.map((e) => e.path).join("\n") + (extra > 0 ? `\n... and ${extra} more files` : "");
}
