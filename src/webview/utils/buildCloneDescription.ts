/**
 * Minimal shape of the source pull request needed to build a clone description.
 * Declared structurally (rather than importing `GitHubPR`) so this helper stays
 * dependency-free and can be unit-tested from the extension test harness.
 */
export interface ClonePrSource {
  number: number;
  html_url: string;
  body?: string | null;
}

/**
 * Build the description that pre-fills the PR Clone form.
 *
 * The original PR body is used whenever it has content. When the source PR has
 * an empty body, the repository's pull request template (when one is available)
 * is used as a fallback scaffold. A back-reference link to the source PR is
 * always added on the first line.
 */
export const buildCloneDescription = (pr: ClonePrSource, template?: string): string => {
  const header = `[Cloned from PR #${pr.number}](${pr.html_url})`;
  const body = pr.body ?? '';
  const hasBody = body.trim().length > 0;
  const content = hasBody ? body : template ?? '';

  return [header, '', content].join('\n');
};
