import type { RepoAnalysis } from "./analysis-schema";

export type LearningView = "overview" | "architecture" | "start" | "flow" | "concepts" | "ask";

export interface LearningProgress {
  version: 1;
  completedFiles: string[];
  completedFlowSteps: Record<string, string[]>;
  selectedFlowId?: string;
  visitedConcepts: string[];
  completedConcepts: string[];
  selectedConcept?: string;
  lastView: LearningView;
}

export interface SavedRepository {
  id: string;
  repositoryId: string;
  analysisId: string | null;
  owner: string;
  repo: string;
  description: string | null;
  language: string | null;
  defaultBranch: string | null;
  lastCommitSha: string | null;
  savedAt: string;
  lastOpenedAt: string;
  progress: {
    completedFiles: number;
    totalFiles: number;
    completedFlows: number;
    totalFlows: number;
    exploredConcepts: number;
    totalConcepts: number;
  };
}

export const EMPTY_PROGRESS: LearningProgress = {
  version: 1,
  completedFiles: [],
  completedFlowSteps: {},
  visitedConcepts: [],
  completedConcepts: [],
  lastView: "overview",
};

const VALID_VIEWS = new Set<LearningView>([
  "overview",
  "architecture",
  "start",
  "flow",
  "concepts",
  "ask",
]);

function strings(value: unknown, max = 200): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string"))].slice(
    0,
    max,
  );
}

export function parseLearningProgress(value: unknown): LearningProgress {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const flowStepsRaw =
    raw["completedFlowSteps"] && typeof raw["completedFlowSteps"] === "object"
      ? (raw["completedFlowSteps"] as Record<string, unknown>)
      : {};
  const completedFlowSteps = Object.fromEntries(
    Object.entries(flowStepsRaw)
      .slice(0, 50)
      .map(([flowId, steps]) => [flowId, strings(steps, 100)]),
  );
  return {
    version: 1,
    completedFiles: strings(raw["completedFiles"]),
    completedFlowSteps,
    ...(typeof raw["selectedFlowId"] === "string" ? { selectedFlowId: raw["selectedFlowId"] } : {}),
    visitedConcepts: strings(raw["visitedConcepts"]),
    completedConcepts: strings(raw["completedConcepts"]),
    ...(typeof raw["selectedConcept"] === "string"
      ? { selectedConcept: raw["selectedConcept"] }
      : {}),
    lastView:
      typeof raw["lastView"] === "string" && VALID_VIEWS.has(raw["lastView"] as LearningView)
        ? (raw["lastView"] as LearningView)
        : "overview",
  };
}

export function flowStepKey(order: number, filePath: string): string {
  return `${order}:${filePath}`;
}

export function reconcileLearningProgress(
  value: unknown,
  analysis: RepoAnalysis,
): LearningProgress {
  const progress = parseLearningProgress(value);
  const files = new Set(analysis.importantFiles.map((file) => file.path));
  const concepts = new Set(analysis.conceptsToLearn.map((concept) => concept.name));
  const flows = new Map(
    (analysis.flows ?? []).map((flow) => [
      flow.id,
      new Set(flow.steps.map((step) => flowStepKey(step.order, step.filePath))),
    ]),
  );
  const completedFlowSteps = Object.fromEntries(
    Object.entries(progress.completedFlowSteps).flatMap(([flowId, steps]) => {
      const validSteps = flows.get(flowId);
      if (!validSteps) return [];
      return [[flowId, steps.filter((step) => validSteps.has(step))]];
    }),
  );
  const selectedConcept =
    progress.selectedConcept && concepts.has(progress.selectedConcept)
      ? progress.selectedConcept
      : analysis.conceptsToLearn[0]?.name;
  const selectedFlowId =
    progress.selectedFlowId && flows.has(progress.selectedFlowId)
      ? progress.selectedFlowId
      : analysis.flows?.[0]?.id;
  return {
    ...progress,
    completedFiles: progress.completedFiles.filter((path) => files.has(path)),
    completedFlowSteps,
    visitedConcepts: progress.visitedConcepts.filter((name) => concepts.has(name)),
    completedConcepts: progress.completedConcepts.filter((name) => concepts.has(name)),
    ...(selectedConcept ? { selectedConcept } : {}),
    ...(selectedFlowId ? { selectedFlowId } : {}),
  };
}

export function mergeLearningProgress(
  local: LearningProgress,
  remote: LearningProgress,
): LearningProgress {
  const flowIds = new Set([
    ...Object.keys(local.completedFlowSteps),
    ...Object.keys(remote.completedFlowSteps),
  ]);
  const selectedFlowId = local.selectedFlowId ?? remote.selectedFlowId;
  const selectedConcept = local.selectedConcept ?? remote.selectedConcept;
  return {
    version: 1,
    completedFiles: [...new Set([...remote.completedFiles, ...local.completedFiles])],
    completedFlowSteps: Object.fromEntries(
      [...flowIds].map((id) => [
        id,
        [
          ...new Set([
            ...(remote.completedFlowSteps[id] ?? []),
            ...(local.completedFlowSteps[id] ?? []),
          ]),
        ],
      ]),
    ),
    ...(selectedFlowId ? { selectedFlowId } : {}),
    visitedConcepts: [...new Set([...remote.visitedConcepts, ...local.visitedConcepts])],
    completedConcepts: [...new Set([...remote.completedConcepts, ...local.completedConcepts])],
    ...(selectedConcept ? { selectedConcept } : {}),
    lastView: local.lastView !== "overview" ? local.lastView : remote.lastView,
  };
}
