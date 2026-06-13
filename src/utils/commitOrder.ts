export function orderSelectedCommits(
  commits: ReadonlyArray<{ sha: string }>,
  selectedCommits: readonly string[]
): string[] {
  const selected = new Set(selectedCommits);
  return commits.filter((commit) => selected.has(commit.sha)).map((commit) => commit.sha);
}
