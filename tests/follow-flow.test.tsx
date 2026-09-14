import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  groundRepositoryFlows,
  validateAnalysis,
  type AnalysisRecord,
  type RepositoryFlow,
} from "../src/lib/analysis-schema";
import { FollowTheFlow } from "../src/components/codecompass/CodeCompassApp";
import { githubFileUrl, selectedRepositoryFlow } from "../src/lib/flow-utils";

const FLOWS: RepositoryFlow[] = [
  {
    id: "public-to-core",
    title: "Public API to core",
    summary: "Follow an exported method into the core implementation.",
    difficulty: "beginner",
    steps: [
      {
        order: 1,
        label: "Public entry point",
        filePath: "source/index.ts",
        explanation: "The package exports its public API here.",
        whatToNotice: "Look for the exported methods.",
        nextReason: "delegates work to the core",
        concepts: ["Exports"],
      },
      {
        order: 2,
        label: "Core implementation",
        filePath: "source/core.ts",
        explanation: "The main operation runs here.",
        whatToNotice: "Notice how options reach the implementation.",
        concepts: ["Control flow"],
      },
    ],
  },
  {
    id: "config-to-runtime",
    title: "Configuration to runtime",
    summary: "See how package configuration becomes runtime behavior.",
    difficulty: "intermediate",
    steps: [
      {
        order: 1,
        label: "Configuration",
        filePath: "package.json",
        explanation: "Package settings establish the entry point.",
        whatToNotice: "Look at exports and scripts.",
        nextReason: "loads the package entry",
        concepts: ["Package metadata"],
      },
      {
        order: 2,
        label: "Runtime entry",
        filePath: "source/index.ts",
        explanation: "Runtime initialization begins here.",
        whatToNotice: "Notice the first imported module.",
        concepts: ["Initialization"],
      },
    ],
  },
];

function rawAnalysis(flows?: unknown) {
  return {
    summary: {
      whatItDoes: "A small example library.",
      whoItsFor: "Developers",
      projectType: "Library",
      beginnerMentalModel: "A public entry point delegating to a core module.",
    },
    technologies: [],
    architecture: [
      {
        id: "core",
        name: "Core",
        description: "Core module",
        relatedFiles: ["source/core.ts"],
        connectsTo: [],
        concepts: [],
      },
    ],
    importantFiles: [
      {
        path: "source/index.ts",
        filename: "index.ts",
        category: "Entry",
        whyItMatters: "It is public.",
        beginnerExplanation: "Start here.",
        difficulty: "beginner",
        recommendedOrder: 1,
        concepts: [],
      },
    ],
    conceptsToLearn: [],
    ...(flows === undefined ? {} : { flows }),
  };
}

function record(flows?: RepositoryFlow[]): AnalysisRecord {
  return {
    analysisId: "analysis-1",
    repositoryId: "repository-1",
    commitSha: "abc123",
    status: "complete",
    cached: true,
    createdAt: "2026-09-14T12:00:00.000Z",
    meta: {
      owner: "owner",
      repo: "repo",
      description: "Example",
      htmlUrl: "https://github.com/owner/repo",
      defaultBranch: "main",
      language: "TypeScript",
      stars: 1,
      forks: 0,
      openIssues: 0,
      license: "MIT",
      topics: [],
      pushedAt: null,
      sizeKb: 1,
      archived: false,
    },
    snapshot: {
      totalFiles: 3,
      directories: 1,
      analyzedFiles: 3,
      manifests: ["package.json"],
      topDirectories: [{ name: "source", files: 2 }],
    },
    analysis: validateAnalysis(rawAnalysis(flows)),
  };
}

describe("Follow the Flow", () => {
  test("valid flow survives grounding", () => {
    expect(
      groundRepositoryFlows(FLOWS.slice(0, 1), ["source/index.ts", "source/core.ts"]),
    ).toHaveLength(1);
  });

  test("hallucinated file paths are removed", () => {
    const flow = structuredClone(FLOWS[0]!);
    flow.steps.splice(1, 0, {
      order: 2,
      label: "Imaginary layer",
      filePath: "source/does-not-exist.ts",
      explanation: "This must not render.",
      whatToNotice: "Nothing.",
    });
    const grounded = groundRepositoryFlows([flow], ["source/index.ts", "source/core.ts"]);
    expect(grounded?.[0]?.steps.map((step) => step.filePath)).toEqual([
      "source/index.ts",
      "source/core.ts",
    ]);
  });

  test("a flow made unusable by grounding is removed", () => {
    expect(groundRepositoryFlows(FLOWS.slice(0, 1), ["source/index.ts"])).toEqual([]);
  });

  test("legacy cached analysis without flows still loads", () => {
    const legacy = validateAnalysis(rawAnalysis());
    expect(legacy.flows).toBeUndefined();
    const html = renderToStaticMarkup(<FollowTheFlow record={record()} onReanalyze={() => {}} />);
    expect(html).toContain("Flow mapping isn’t available");
    expect(html).toContain("Re-analyze repository");
  });

  test("multiple flows render as accessible selectors", () => {
    const html = renderToStaticMarkup(
      <FollowTheFlow record={record(FLOWS)} onReanalyze={() => {}} />,
    );
    expect(html).toContain("Choose a repository flow");
    expect(html).toContain("Public API to core");
    expect(html).toContain("Configuration to runtime");
    expect(html).toContain('class="active" aria-pressed="true"');
    expect(html).toContain('class="" aria-pressed="false"');
  });

  test("switching selection is a local data operation", () => {
    expect(selectedRepositoryFlow(FLOWS, "config-to-runtime")?.title).toBe(
      "Configuration to runtime",
    );
  });

  test("file links point to the exact GitHub repository file", () => {
    expect(githubFileUrl("https://github.com/owner/repo", "abc123", "source/a file.ts")).toBe(
      "https://github.com/owner/repo/blob/abc123/source/a%20file.ts",
    );
  });

  test("mobile flow navigation exposes full-size buttons without a carousel", async () => {
    const html = renderToStaticMarkup(
      <FollowTheFlow record={record(FLOWS)} onReanalyze={() => {}} />,
    );
    const css = await Bun.file(new URL("../src/styles.css", import.meta.url)).text();
    expect(html).toContain("flow-selector");
    expect(html.match(/<button/g)?.length).toBeGreaterThanOrEqual(4);
    expect(css).toContain(".flow-selector {\n    grid-template-columns: minmax(0, 1fr);");
    expect(css).not.toContain(".flow-selector {\n    overflow-x: auto;");
  });
});
