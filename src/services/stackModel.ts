import { PrStack } from './prStack';

export interface StackViewBranchPr {
  number: number;
  title: string;
  url: string;
  state: 'open' | 'closed';
  draft?: boolean;
}

export interface StackViewBranch {
  branch: string;
  isCurrent: boolean;
  /** Present for a `source: 'github'` view; absent for a heuristic-derived view. */
  pr?: StackViewBranchPr;
}

/** Commits the target branch's local tip is ahead/behind its remote-tracking ref. */
export interface StackAheadBehind {
  ahead: number;
  behind: number;
}

export interface StackView {
  /** Bottom (closest to `target`) -> top. Excludes the target itself. */
  branches: StackViewBranch[];
  /** The branch this stack is ultimately aimed at (may be trunk or any other branch). */
  target: string;
  targetIsCurrent: boolean;
  /** Undefined when the target has no upstream (nothing to compare against). */
  targetAheadBehind?: StackAheadBehind;
  source: 'github' | 'heuristic';
  repositoryPath: string;
}

export interface StackBranchMeta {
  prNumber?: number;
  prTitle?: string;
  prState?: string;
}

/** Builds the view model for a GitHub-Stacks-API-derived stack (the authoritative path). */
export function stackViewFromPrStack(
  stack: PrStack,
  currentBranch: string,
  repositoryPath: string,
  targetAheadBehind?: StackAheadBehind
): StackView {
  return {
    branches: stack.nodes.map((node, index) => ({
      branch: node.branch,
      isCurrent: index === stack.currentIndex,
      pr: { number: node.prNumber, title: node.title, url: node.url, state: node.state, draft: node.draft },
    })),
    target: stack.target,
    targetIsCurrent: stack.currentIndex === -1 && stack.target === currentBranch,
    targetAheadBehind,
    source: 'github',
    repositoryPath,
  };
}

/** Builds the view model for a heuristic (offline fallback) stack — no PR metadata. */
export function stackViewFromForest(
  orderedBottomToTop: string[],
  trunk: string,
  currentBranch: string,
  repositoryPath: string,
  targetAheadBehind?: StackAheadBehind
): StackView {
  return {
    branches: orderedBottomToTop.map((branch) => ({
      branch,
      isCurrent: branch === currentBranch,
    })),
    target: trunk,
    targetIsCurrent: currentBranch === trunk,
    targetAheadBehind,
    source: 'heuristic',
    repositoryPath,
  };
}

/**
 * Bottom-to-top branch name list for the status bar position indicator.
 * Excludes the target: the badge counts only actual stack members (PRs, or
 * heuristic branches) — the target is the base the stack is aimed at, not a
 * stacked PR/branch itself, so it must not inflate "position/size". As a
 * consequence, sitting on the target branch itself yields no stack position
 * (the badge hides), since there's no PR to report a position for.
 */
export function indicatorBranchesOf(view: StackView): string[] {
  return view.branches.map((b) => b.branch);
}

/** PR metadata per branch, for the status bar tooltip. */
export function stackInfoMapOf(view: StackView): Map<string, StackBranchMeta> {
  const info = new Map<string, StackBranchMeta>();
  for (const branch of view.branches) {
    if (branch.pr) {
      info.set(branch.branch, {
        prNumber: branch.pr.number,
        prTitle: branch.pr.title,
        prState: branch.pr.state,
      });
    }
  }
  return info;
}
