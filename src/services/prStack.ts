import { GitHubPR, GitHubStack } from '../types/dataTypes';

export interface PrStackNode {
  /** The branch this open PR is proposed from (`pr.head.ref`). */
  branch: string;
  prNumber: number;
  title: string;
  url: string;
  state: 'open' | 'closed';
  draft?: boolean;
}

export interface PrStack {
  /** Bottom (closest to `target`) -> top. Excludes the target itself. */
  nodes: PrStackNode[];
  /** Base of the bottom PR — has no open PR of its own. May be trunk or any branch. */
  target: string;
  /** Index into `nodes` of the current branch; -1 when the current branch IS the target. */
  currentIndex: number;
}

/**
 * Finds the GitHub-native stack containing `currentBranch` — either as the
 * stack's target (`stack.base.ref`) or as one of its stacked PRs' head
 * branches. Whether something counts as a stack at all is entirely GitHub's
 * call (the stack was explicitly created there); this only locates it.
 */
export function findGithubStackForBranch(
  stacks: GitHubStack[],
  currentBranch: string
): GitHubStack | undefined {
  return stacks.find(
    (stack) =>
      stack.base.ref === currentBranch ||
      stack.pull_requests.some((pr) => pr.head.ref === currentBranch)
  );
}

/**
 * Builds a `PrStack` from a GitHub-native stack. Order and target come
 * straight from the Stacks API (`pull_requests` is already ordered bottom ->
 * top, `base.ref` is the target) — no local head/base-ref walking. Titles/
 * URLs are enriched from `prs` (the already-fetched open-PR list, keyed by
 * number); a stack member without a matching entry there (e.g. it was merged
 * or closed between the two API calls) falls back to a placeholder built
 * from `resolveUrl`.
 */
export function prStackFromGithubStack(
  stack: GitHubStack,
  prs: GitHubPR[],
  currentBranch: string,
  resolveUrl: (prNumber: number) => string
): PrStack {
  const prsByNumber = new Map(prs.map((pr) => [pr.number, pr]));

  const nodes: PrStackNode[] = stack.pull_requests.map((stackPr) => {
    const pr = prsByNumber.get(stackPr.number);
    return {
      branch: stackPr.head.ref,
      prNumber: stackPr.number,
      title: pr?.title ?? `PR #${stackPr.number}`,
      url: pr?.html_url ?? resolveUrl(stackPr.number),
      state: stackPr.state,
      draft: stackPr.draft,
    };
  });

  return {
    nodes,
    target: stack.base.ref,
    currentIndex: nodes.findIndex((node) => node.branch === currentBranch),
  };
}
