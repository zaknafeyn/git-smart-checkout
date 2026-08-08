import { GitHubPR } from '../types/dataTypes';

export interface PrStackNode {
  /** The branch this open PR is proposed from (`pr.head.ref`). */
  branch: string;
  prNumber: number;
  title: string;
  url: string;
  state: 'open' | 'closed';
  draft?: boolean;
  /** The branch this PR targets (`pr.base.ref`). */
  base: string;
}

export interface PrStack {
  /** Bottom (closest to `target`) -> top. Excludes the target itself. */
  nodes: PrStackNode[];
  /** Base of the bottom PR — has no open PR of its own. May be trunk or any branch. */
  target: string;
  /** Index into `nodes` of the current branch; -1 when the current branch IS the target. */
  currentIndex: number;
  /** Branches where more than one open PR shares the same base — the lowest PR number was chosen. */
  forkedAt: string[];
}

export interface BuildPrStackOptions {
  trunk?: string;
}

/**
 * Walks a chain of open PRs linked `head -> base`, starting from
 * `currentBranch`, in both directions: down toward the branch the chain
 * ultimately targets (the "target", which may be trunk or any other branch),
 * and up toward the tip of the stack. Pure and synchronous — the caller
 * supplies the already-fetched PR list.
 *
 * Deliberately has no `localBranches` filter and does not special-case
 * `base === trunk`: a PR stack is defined purely by PR base links, so
 * remote-only branches and stacks whose bottom PR targets trunk are both
 * valid stacks.
 */
export function buildPrStack(
  prs: GitHubPR[],
  currentBranch: string,
  options: BuildPrStackOptions = {}
): PrStack | undefined {
  const { trunk } = options;

  if (trunk && currentBranch === trunk) {
    return undefined;
  }

  const normalized = prs.filter((pr) => {
    const head = pr.head?.ref;
    const base = pr.base?.ref;
    if (!head || !base || head === base) {
      return false;
    }
    if (pr.state === 'closed') {
      return false;
    }
    // Skip fork PRs: a fork's head ref lives in a different repo and can
    // collide by name with an unrelated same-repo local branch.
    const headRepo = pr.head.repo?.full_name;
    const baseRepo = pr.base.repo?.full_name;
    if (headRepo && baseRepo && headRepo !== baseRepo) {
      return false;
    }
    return true;
  });

  const byHead = new Map<string, GitHubPR>();
  for (const pr of normalized) {
    const existing = byHead.get(pr.head.ref);
    if (!existing || pr.number < existing.number) {
      byHead.set(pr.head.ref, pr);
    }
  }

  const childrenByBase = new Map<string, GitHubPR[]>();
  for (const pr of normalized) {
    const siblings = childrenByBase.get(pr.base.ref) ?? [];
    siblings.push(pr);
    childrenByBase.set(pr.base.ref, siblings);
  }

  const toNode = (pr: GitHubPR): PrStackNode => ({
    branch: pr.head.ref,
    prNumber: pr.number,
    title: pr.title,
    url: pr.html_url,
    state: pr.state ?? 'open',
    draft: pr.draft,
    base: pr.base.ref,
  });

  const visited = new Set<string>([currentBranch]);
  const forkedAt: string[] = [];

  // Down: currentBranch -> base -> base -> ... toward the target.
  const down: PrStackNode[] = [];
  let cursor = currentBranch;
  while (byHead.has(cursor)) {
    const pr = byHead.get(cursor) as GitHubPR;
    if (visited.has(pr.base.ref)) {
      break;
    }
    down.push(toNode(pr));
    visited.add(pr.base.ref);
    cursor = pr.base.ref;
  }
  const target = cursor;

  // Up: currentBranch <- head <- head ... toward the tip of the stack.
  const up: PrStackNode[] = [];
  cursor = currentBranch;
  while (true) {
    const children = childrenByBase.get(cursor);
    if (!children || children.length === 0) {
      break;
    }
    let chosen = children[0];
    if (children.length > 1) {
      forkedAt.push(cursor);
      chosen = [...children].sort((a, b) => a.number - b.number)[0];
    }
    if (visited.has(chosen.head.ref)) {
      break;
    }
    up.push(toNode(chosen));
    visited.add(chosen.head.ref);
    cursor = chosen.head.ref;
  }

  const nodes = [...down.reverse(), ...up];

  if (nodes.length === 0) {
    return undefined;
  }
  // A single PR onto trunk isn't a stack; a single PR onto any other base still is.
  if (nodes.length === 1 && trunk && target === trunk) {
    return undefined;
  }

  const currentIndex = nodes.findIndex((node) => node.branch === currentBranch);
  return { nodes, target, currentIndex, forkedAt };
}
