import { PrStack, StackCheckoutIdentity, StackMemberStatus } from './prStack';

export interface StackViewBranchPr {
  number: number;
  title: string;
  url: string;
  state: 'open' | 'closed';
  draft?: boolean;
  status: StackMemberStatus;
  blockedDownstack: boolean;
}

export interface StackViewBranch {
  branch: string;
  isCurrent: boolean;
  pr: StackViewBranchPr;
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
  /** Index into `branches` of the current checkout; -1 when it isn't a stack member. */
  currentIndex: number;
  /** Undefined when the target has no upstream (nothing to compare against). */
  targetAheadBehind?: StackAheadBehind;
  repositoryPath: string;
}

export interface StackBranchMeta {
  prNumber: number;
  prTitle: string;
  prState: string;
}

/** Builds the view model for a GitHub-Stacks-API-derived stack. */
export function stackViewFromPrStack(
  stack: PrStack,
  identity: StackCheckoutIdentity,
  repositoryPath: string,
  targetAheadBehind?: StackAheadBehind
): StackView {
  return {
    branches: stack.nodes.map((node, index) => ({
      branch: node.branch,
      isCurrent: index === stack.currentIndex,
      pr: {
        number: node.prNumber,
        title: node.title,
        url: node.url,
        state: node.state,
        draft: node.draft,
        status: node.status,
        blockedDownstack: node.blockedDownstack,
      },
    })),
    target: stack.target,
    targetIsCurrent: stack.currentIndex === -1 && stack.target === identity.branch,
    currentIndex: stack.currentIndex,
    targetAheadBehind,
    repositoryPath,
  };
}

/**
 * Bottom-to-top branch name list for the status bar position indicator.
 * Excludes the target: the badge counts only actual stacked PRs — the target
 * is the base the stack is aimed at, not a stacked PR itself, so it must not
 * inflate "position/size". As a consequence, sitting on the target branch
 * itself yields no stack position (the badge hides), since there's no PR to
 * report a position for.
 */
export function indicatorBranchesOf(view: StackView): string[] {
  return view.branches.map((b) => b.branch);
}

/** PR metadata per branch, for the status bar tooltip. */
export function stackInfoMapOf(view: StackView): Map<string, StackBranchMeta> {
  const info = new Map<string, StackBranchMeta>();
  for (const branch of view.branches) {
    info.set(branch.branch, {
      prNumber: branch.pr.number,
      prTitle: branch.pr.title,
      prState: branch.pr.state,
    });
  }
  return info;
}
