import { GitHubPR, GitHubStack, GitHubStackPr } from '../types/dataTypes';

export type StackMemberStatus = 'merged' | 'closed' | 'draft' | 'open';

export interface PrStackNode {
  /** The branch this open PR is proposed from (`pr.head.ref`). */
  branch: string;
  prNumber: number;
  title: string;
  url: string;
  state: 'open' | 'closed';
  draft?: boolean;
  status: StackMemberStatus;
  blockedDownstack: boolean;
}

export interface PrStack {
  /** Bottom (closest to `target`) -> top. Excludes the target itself. */
  nodes: PrStackNode[];
  /** Base of the bottom PR — has no open PR of its own. May be trunk or any branch. */
  target: string;
  /** Index into `nodes` of the current checkout; -1 when it IS the target (or no member matched). */
  currentIndex: number;
}

/** Everything that can identify what the user currently has checked out. */
export interface StackCheckoutIdentity {
  /** `git branch --show-current`; undefined when detached. */
  branch?: string;
  /** Full `git rev-parse HEAD`. */
  headSha?: string;
  /** Parsed from a `pr/<n>-review` worktree branch. */
  prNumber?: number;
  /** Short upstream branch name (remote prefix stripped), for renamed locals. */
  upstreamRef?: string;
}

export type StackMatchKind = 'prNumber' | 'branch' | 'upstream' | 'sha' | 'target';

export interface StackMatch {
  stack: GitHubStack;
  kind: StackMatchKind;
  /** The matched member; undefined for a 'target' match. */
  prNumber?: number;
}

const MATCH_SCORE: Record<StackMatchKind, number> = {
  prNumber: 5,
  branch: 4,
  upstream: 3,
  sha: 2,
  target: 1,
};

function bestMemberMatch(stack: GitHubStack, identity: StackCheckoutIdentity): StackMatch | undefined {
  let best: StackMatch | undefined;

  for (const pr of stack.pull_requests) {
    let kind: StackMatchKind | undefined;
    if (identity.prNumber !== undefined && pr.number === identity.prNumber) {
      kind = 'prNumber';
    } else if (identity.branch !== undefined && pr.head.ref === identity.branch) {
      kind = 'branch';
    } else if (identity.upstreamRef !== undefined && pr.head.ref === identity.upstreamRef) {
      kind = 'upstream';
    } else if (identity.headSha !== undefined && pr.head.sha === identity.headSha) {
      kind = 'sha';
    }

    if (kind && (!best || MATCH_SCORE[kind] > MATCH_SCORE[best.kind])) {
      best = { stack, kind, prNumber: pr.number };
    }
  }

  return best;
}

/**
 * Finds the GitHub-native stack matching the current checkout, by precedence
 * `prNumber > branch > upstream > sha > target` (a member match always beats
 * a target match). Dissolved stacks (`open === false`) are excluded. Whether
 * something counts as a stack at all is entirely GitHub's call (the stack was
 * explicitly created there); this only locates it — however the checkout was
 * reached (branch switch, PR-review worktree, detached HEAD, renamed local).
 */
export function findGithubStackForCheckout(
  stacks: GitHubStack[],
  identity: StackCheckoutIdentity
): StackMatch | undefined {
  let best: StackMatch | undefined;

  for (const stack of stacks) {
    if (stack.open === false) {
      continue;
    }

    const memberMatch = bestMemberMatch(stack, identity);
    const candidate: StackMatch | undefined =
      memberMatch ?? (identity.branch !== undefined && stack.base.ref === identity.branch
        ? { stack, kind: 'target' }
        : undefined);

    if (!candidate) {
      continue;
    }

    if (
      !best ||
      MATCH_SCORE[candidate.kind] > MATCH_SCORE[best.kind] ||
      (MATCH_SCORE[candidate.kind] === MATCH_SCORE[best.kind] &&
        (candidate.stack.created_at > best.stack.created_at ||
          (candidate.stack.created_at === best.stack.created_at && candidate.stack.number > best.stack.number)))
    ) {
      best = candidate;
    }
  }

  return best;
}

/** @deprecated Use `findGithubStackForCheckout` with a full `StackCheckoutIdentity`. Kept for branch-only call sites. */
export function findGithubStackForBranch(stacks: GitHubStack[], currentBranch: string): GitHubStack | undefined {
  return findGithubStackForCheckout(stacks, { branch: currentBranch })?.stack;
}

/** Derives a stack member's display status from the fields the Stacks API actually reports. */
export function stackMemberStatus(pr: GitHubStackPr): StackMemberStatus {
  if (pr.merged_at !== null) {
    return 'merged';
  }
  if (pr.state === 'closed') {
    return 'closed';
  }
  if (pr.draft) {
    return 'draft';
  }
  return 'open';
}

/**
 * Whether the member at `index` is blocked from merging by an unmerged
 * draft/closed member below it (closer to the target). This is a local
 * approximation of GitHub's "Blocked downstack" badge — the Stacks API
 * exposes no `mergeable_state` per member, only `state`/`draft`/`merged_at`.
 */
export function isBlockedDownstack(members: GitHubStackPr[], index: number): boolean {
  const status = stackMemberStatus(members[index]);
  if (status === 'merged' || status === 'closed') {
    return false;
  }
  for (let j = 0; j < index; j++) {
    const belowStatus = stackMemberStatus(members[j]);
    if (belowStatus === 'draft' || belowStatus === 'closed') {
      return true;
    }
  }
  return false;
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
  match: StackMatch | undefined,
  resolveUrl: (prNumber: number) => string
): PrStack {
  const prsByNumber = new Map(prs.map((pr) => [pr.number, pr]));

  const nodes: PrStackNode[] = stack.pull_requests.map((stackPr, index) => {
    const pr = prsByNumber.get(stackPr.number);
    return {
      branch: stackPr.head.ref,
      prNumber: stackPr.number,
      title: pr?.title ?? `PR #${stackPr.number}`,
      url: pr?.html_url ?? resolveUrl(stackPr.number),
      state: stackPr.state,
      draft: stackPr.draft,
      status: stackMemberStatus(stackPr),
      blockedDownstack: isBlockedDownstack(stack.pull_requests, index),
    };
  });

  const currentIndex =
    match?.prNumber !== undefined ? nodes.findIndex((node) => node.prNumber === match.prNumber) : -1;

  return {
    nodes,
    target: stack.base.ref,
    currentIndex,
  };
}
