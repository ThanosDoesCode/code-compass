import { createServerFn } from "@tanstack/react-start";

import type { Json } from "@/integrations/supabase/types";
import type { RepoAnalysis, RepoMeta } from "./analysis-schema";
import {
  EMPTY_PROGRESS,
  parseLearningProgress,
  reconcileLearningProgress,
  type LearningProgress,
  type LearningView,
  type SavedRepository,
} from "./account-schema";

interface AccountFailure {
  ok: false;
  code: "auth_required" | "auth_expired" | "auth_config" | "storage" | "invalid_input";
  message: string;
}

type AccountResult<T> = ({ ok: true } & T) | AccountFailure;

function failure(error: unknown): AccountFailure {
  if (error && typeof error === "object" && "code" in error) {
    const value = error as { code?: string; message?: string };
    if (
      value.code === "auth_required" ||
      value.code === "auth_expired" ||
      value.code === "auth_config"
    ) {
      return { ok: false, code: value.code, message: value.message ?? "Account access failed." };
    }
  }
  console.error(
    "[Account] Server operation failed",
    error instanceof Error ? error.message : error,
  );
  return {
    ok: false,
    code: "storage",
    message: "Account data could not be saved. Please try again.",
  };
}

function toJson(value: unknown): Json {
  if (value === null || ["string", "number", "boolean"].includes(typeof value))
    return value as Json;
  if (Array.isArray(value)) return value.map(toJson);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, entry]) =>
        entry === undefined ? [] : [[key, toJson(entry)]],
      ),
    );
  }
  throw new TypeError("Value cannot be stored as JSON.");
}

async function account() {
  return (await import("./account.server")).authenticatedAccount();
}

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

async function analysisRecord(analysisId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(analysisId)) throw new Error("Invalid analysis identifier.");
  const db = await admin();
  const { data, error } = await db
    .from("analyses")
    .select("id, repository_id, commit_sha, analysis_json, context_json, status")
    .eq("id", analysisId)
    .maybeSingle();
  if (error || !data || data.status !== "complete" || !data.analysis_json) {
    throw new Error("The completed analysis no longer exists.");
  }
  return data;
}

export const getAccountOverview = createServerFn({ method: "GET" }).handler(
  async (): Promise<
    AccountResult<{
      profile: { displayName: string | null; avatarUrl: string | null; email: string | null };
      repositories: SavedRepository[];
    }>
  > => {
    try {
      const { client, user } = await account();
      const [{ data: profile }, { data: repositories, error }, { data: progressRows }] =
        await Promise.all([
          client.from("profiles").select("display_name, avatar_url").maybeSingle(),
          client
            .from("user_repositories")
            .select("*")
            .order("last_opened_at", { ascending: false })
            .limit(50),
          client.from("learning_progress").select("repository_id, progress_json"),
        ]);
      if (error) throw error;

      const rows = repositories ?? [];
      const analysisIds = rows
        .map((row) => row.analysis_id)
        .filter((id): id is string => Boolean(id));
      const db = await admin();
      const { data: analyses } = analysisIds.length
        ? await db.from("analyses").select("id, analysis_json").in("id", analysisIds)
        : { data: [] };
      const analysisById = new Map(
        (analyses ?? []).map((row) => [row.id, row.analysis_json as unknown as RepoAnalysis]),
      );
      const progressByRepository = new Map(
        (progressRows ?? []).map((row) => [row.repository_id, row.progress_json]),
      );

      return {
        ok: true,
        profile: {
          displayName: profile?.display_name ?? null,
          avatarUrl: profile?.avatar_url ?? null,
          email: user.email ?? null,
        },
        repositories: rows.map((row) => {
          const analysis = row.analysis_id ? analysisById.get(row.analysis_id) : undefined;
          const progress = analysis
            ? reconcileLearningProgress(progressByRepository.get(row.repository_id), analysis)
            : EMPTY_PROGRESS;
          const flows = analysis?.flows ?? [];
          const completedFlows = flows.filter(
            (flow) =>
              flow.steps.length > 0 &&
              flow.steps.every((step) =>
                (progress.completedFlowSteps[flow.id] ?? []).includes(
                  `${step.order}:${step.filePath}`,
                ),
              ),
          ).length;
          return {
            id: row.id,
            repositoryId: row.repository_id,
            analysisId: row.analysis_id,
            owner: row.owner,
            repo: row.repo,
            description: row.description,
            language: row.language,
            defaultBranch: row.default_branch,
            lastCommitSha: row.last_commit_sha,
            savedAt: row.saved_at,
            lastOpenedAt: row.last_opened_at,
            progress: {
              completedFiles: progress.completedFiles.length,
              totalFiles: analysis?.importantFiles.length ?? 0,
              completedFlows,
              totalFlows: flows.length,
              exploredConcepts: progress.visitedConcepts.length,
              totalConcepts: analysis?.conceptsToLearn.length ?? 0,
            },
          };
        }),
      };
    } catch (error) {
      return failure(error);
    }
  },
);

export const saveCurrentRepository = createServerFn({ method: "POST" })
  .validator((data: { analysisId: string }) => ({ analysisId: String(data?.analysisId ?? "") }))
  .handler(async ({ data }): Promise<AccountResult<{ savedRepositoryId: string }>> => {
    try {
      const [{ client, user }, analysis] = await Promise.all([
        account(),
        analysisRecord(data.analysisId),
      ]);
      const context = analysis.context_json as unknown as { meta?: RepoMeta } | null;
      const meta = context?.meta;
      if (!meta) throw new Error("Repository metadata is unavailable.");
      const { data: saved, error } = await client
        .from("user_repositories")
        .upsert(
          {
            user_id: user.id,
            repository_id: analysis.repository_id,
            analysis_id: analysis.id,
            owner: meta.owner,
            repo: meta.repo,
            description: meta.description,
            language: meta.language,
            default_branch: meta.defaultBranch,
            last_commit_sha: analysis.commit_sha,
            last_opened_at: new Date().toISOString(),
          },
          { onConflict: "user_id,repository_id" },
        )
        .select("id")
        .single();
      if (error || !saved) throw error ?? new Error("Save failed.");
      return { ok: true, savedRepositoryId: saved.id };
    } catch (error) {
      return failure(error);
    }
  });

export const removeSavedRepository = createServerFn({ method: "POST" })
  .validator((data: { savedRepositoryId: string }) => ({
    savedRepositoryId: String(data?.savedRepositoryId ?? ""),
  }))
  .handler(async ({ data }): Promise<AccountResult<{ removed: true }>> => {
    try {
      const { client } = await account();
      const { error } = await client
        .from("user_repositories")
        .delete()
        .eq("id", data.savedRepositoryId);
      if (error) throw error;
      return { ok: true, removed: true };
    } catch (error) {
      return failure(error);
    }
  });

export const touchSavedRepository = createServerFn({ method: "POST" })
  .validator((data: { savedRepositoryId: string }) => ({
    savedRepositoryId: String(data?.savedRepositoryId ?? ""),
  }))
  .handler(async ({ data }): Promise<AccountResult<{ touched: true }>> => {
    try {
      const { client } = await account();
      const { error } = await client
        .from("user_repositories")
        .update({ last_opened_at: new Date().toISOString() })
        .eq("id", data.savedRepositoryId);
      if (error) throw error;
      return { ok: true, touched: true };
    } catch (error) {
      return failure(error);
    }
  });

export const loadLearningProgress = createServerFn({ method: "POST" })
  .validator((data: { analysisId: string }) => ({ analysisId: String(data?.analysisId ?? "") }))
  .handler(async ({ data }): Promise<AccountResult<{ progress: LearningProgress }>> => {
    try {
      const [{ client }, analysis] = await Promise.all([
        account(),
        analysisRecord(data.analysisId),
      ]);
      const { data: row, error } = await client
        .from("learning_progress")
        .select("progress_json, last_view")
        .eq("repository_id", analysis.repository_id)
        .maybeSingle();
      if (error) throw error;
      const progress = reconcileLearningProgress(
        row ? { ...parseLearningProgress(row.progress_json), lastView: row.last_view } : null,
        analysis.analysis_json as unknown as RepoAnalysis,
      );
      return { ok: true, progress };
    } catch (error) {
      return failure(error);
    }
  });

export const saveLearningProgress = createServerFn({ method: "POST" })
  .validator((data: { analysisId: string; progress: LearningProgress }) => ({
    analysisId: String(data?.analysisId ?? ""),
    progress: parseLearningProgress(data?.progress),
  }))
  .handler(async ({ data }): Promise<AccountResult<{ progress: LearningProgress }>> => {
    try {
      const [{ client, user }, analysis] = await Promise.all([
        account(),
        analysisRecord(data.analysisId),
      ]);
      const progress = reconcileLearningProgress(
        data.progress,
        analysis.analysis_json as unknown as RepoAnalysis,
      );
      const { error } = await client.from("learning_progress").upsert(
        {
          user_id: user.id,
          repository_id: analysis.repository_id,
          analysis_id: analysis.id,
          progress_json: toJson(progress),
          last_view: progress.lastView as LearningView,
        },
        { onConflict: "user_id,repository_id" },
      );
      if (error) throw error;
      return { ok: true, progress };
    } catch (error) {
      return failure(error);
    }
  });
