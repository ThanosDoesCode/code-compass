import { describe, expect, test } from "bun:test";

import type { RepoAnalysis } from "../src/lib/analysis-schema";
import {
  EMPTY_PROGRESS,
  flowStepKey,
  mergeLearningProgress,
  parseLearningProgress,
  reconcileLearningProgress,
} from "../src/lib/account-schema";

const analysis = {
  importantFiles: [{ path: "src/index.ts" }, { path: "src/core.ts" }],
  conceptsToLearn: [{ name: "Fetch" }, { name: "Hooks" }],
  flows: [
    {
      id: "request",
      steps: [
        { order: 1, filePath: "src/index.ts" },
        { order: 2, filePath: "src/core.ts" },
      ],
    },
  ],
} as RepoAnalysis;

describe("learning progress foundation", () => {
  test("progress round-trips through persisted JSON", () => {
    const saved = {
      ...EMPTY_PROGRESS,
      completedFiles: ["src/index.ts"],
      lastView: "start" as const,
    };
    expect(parseLearningProgress(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });

  test("resume restores the last valid section and selections", () => {
    const progress = reconcileLearningProgress(
      {
        lastView: "concepts",
        selectedConcept: "Hooks",
        selectedFlowId: "request",
      },
      analysis,
    );
    expect(progress.lastView).toBe("concepts");
    expect(progress.selectedConcept).toBe("Hooks");
    expect(progress.selectedFlowId).toBe("request");
  });

  test("stale progress is discarded after an analysis changes", () => {
    const progress = reconcileLearningProgress(
      {
        completedFiles: ["src/index.ts", "removed.ts"],
        visitedConcepts: ["Fetch", "Removed concept"],
        completedConcepts: ["Removed concept"],
        selectedConcept: "Removed concept",
        selectedFlowId: "removed-flow",
        completedFlowSteps: {
          request: [flowStepKey(1, "src/index.ts"), "3:removed.ts"],
          "removed-flow": ["1:removed.ts"],
        },
      },
      analysis,
    );
    expect(progress.completedFiles).toEqual(["src/index.ts"]);
    expect(progress.visitedConcepts).toEqual(["Fetch"]);
    expect(progress.completedConcepts).toEqual([]);
    expect(progress.selectedConcept).toBe("Fetch");
    expect(progress.selectedFlowId).toBe("request");
    expect(progress.completedFlowSteps).toEqual({ request: ["1:src/index.ts"] });
  });

  test("anonymous progress merges into an account without being lost", () => {
    const account = parseLearningProgress({
      completedFiles: ["src/core.ts"],
      visitedConcepts: ["Hooks"],
      lastView: "overview",
    });
    const anonymous = parseLearningProgress({
      completedFiles: ["src/index.ts"],
      visitedConcepts: ["Fetch"],
      lastView: "start",
    });
    const merged = mergeLearningProgress(account, anonymous);
    expect(new Set(merged.completedFiles)).toEqual(new Set(["src/index.ts", "src/core.ts"]));
    expect(new Set(merged.visitedConcepts)).toEqual(new Set(["Fetch", "Hooks"]));
    expect(merged.lastView).toBe("start");
  });
});

describe("database account security", () => {
  const migration = Bun.file(
    new URL(
      "../supabase/migrations/20260915000000_add_accounts_and_learning_progress.sql",
      import.meta.url,
    ),
  ).text();

  test("new users receive a minimal profile", async () => {
    const sql = await migration;
    expect(sql).toContain("AFTER INSERT ON auth.users");
    expect(sql).toContain("INSERT INTO public.profiles");
  });

  test("duplicate saved repositories are prevented per user", async () => {
    expect(await migration).toContain("UNIQUE (user_id, repository_id)");
  });

  test("anonymous roles cannot enumerate account data", async () => {
    const sql = await migration;
    expect(sql).toContain("REVOKE ALL ON TABLE public.user_repositories FROM PUBLIC, anon");
    expect(sql).toContain("REVOKE ALL ON TABLE public.learning_progress FROM PUBLIC, anon");
  });

  test("RLS ownership is derived from auth.uid for both user tables", async () => {
    const sql = await migration;
    expect(sql.match(/\(SELECT auth\.uid\(\)\) = user_id/g)?.length).toBeGreaterThanOrEqual(8);
    expect(sql).not.toContain("USING (true)");
  });

  test("account server actions validate the bearer session and never accept a user id", async () => {
    const helper = await Bun.file(new URL("../src/lib/account.server.ts", import.meta.url)).text();
    const actions = await Bun.file(
      new URL("../src/lib/account.functions.ts", import.meta.url),
    ).text();
    expect(helper).toContain("client.auth.getUser(token)");
    expect(helper).toContain('"auth_expired"');
    expect(actions).not.toMatch(/validator\(\(data: \{[^}]*userId/s);
  });

  test("saving an existing analysis never invokes repository analysis", async () => {
    const actions = await Bun.file(
      new URL("../src/lib/account.functions.ts", import.meta.url),
    ).text();
    expect(actions).toContain("saveCurrentRepository");
    expect(actions).not.toContain("runAnalysis");
    expect(actions).not.toContain("gatewayChat");
  });

  test("saved repositories can be removed through the authenticated RLS client", async () => {
    const actions = await Bun.file(
      new URL("../src/lib/account.functions.ts", import.meta.url),
    ).text();
    const removeAction = actions.slice(
      actions.indexOf("removeSavedRepository"),
      actions.indexOf("touchSavedRepository"),
    );
    expect(removeAction).toContain('.from("user_repositories")');
    expect(removeAction).toContain(".delete()");
    expect(removeAction).not.toContain("userId");
  });

  test("missing or invalid optional auth remains anonymous", async () => {
    const helper = await Bun.file(new URL("../src/lib/account.server.ts", import.meta.url)).text();
    expect(helper).toContain("if (!token) return null");
    expect(helper).toContain("return error ? null : data.user");
  });

  test("auth restoration has an explicit non-signed-out state", async () => {
    const auth = await Bun.file(
      new URL("../src/components/codecompass/CodeCompassAuth.tsx", import.meta.url),
    ).text();
    const app = await Bun.file(
      new URL("../src/components/codecompass/CodeCompassApp.tsx", import.meta.url),
    ).text();
    expect(auth).toContain('useState<AuthStatus>("restoring")');
    expect(app).toContain('auth.status === "restoring"');
  });
});
