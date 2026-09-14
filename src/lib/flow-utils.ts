import type { RepositoryFlow } from "./analysis-schema";

export function githubFileUrl(htmlUrl: string, commitSha: string, filePath: string): string {
  const base = htmlUrl.replace(/\/$/, "");
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  return `${base}/blob/${encodeURIComponent(commitSha)}/${encodedPath}`;
}

export function selectedRepositoryFlow(
  flows: RepositoryFlow[],
  selectedId: string,
): RepositoryFlow | undefined {
  return flows.find((flow) => flow.id === selectedId) ?? flows[0];
}
