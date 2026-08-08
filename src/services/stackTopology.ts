import { StackEntry } from './stackStore';

export interface StackForest {
  /** Branches with no recorded parent — the base of each stack. */
  roots: string[];
  /** parent branch -> child branch names. */
  childrenOf: Map<string, string[]>;
  /** branch -> parent branch, for quick lookup. */
  parentOf: Map<string, string>;
}

/**
 * Builds a forest from stack entries, after dropping entries whose branch or
 * parent no longer exists locally (handles the "parent branch deleted"
 * edge case: an orphaned child simply has no entry left, so it becomes a
 * root of its own — implicitly reparented to trunk).
 */
export function buildStackForest(entries: StackEntry[], liveBranches: Set<string>): StackForest {
  const valid = entries.filter((entry) => liveBranches.has(entry.branch) && liveBranches.has(entry.parent));

  const childrenOf = new Map<string, string[]>();
  const parentOf = new Map<string, string>();
  const allBranches = new Set<string>();

  for (const entry of valid) {
    allBranches.add(entry.branch);
    allBranches.add(entry.parent);
    parentOf.set(entry.branch, entry.parent);
    const siblings = childrenOf.get(entry.parent) ?? [];
    siblings.push(entry.branch);
    childrenOf.set(entry.parent, siblings);
  }

  const roots = [...allBranches].filter((branch) => !parentOf.has(branch));

  return { roots, childrenOf, parentOf };
}

/**
 * Depth-first, bottom-to-top (root first) traversal of a stack rooted at
 * `root`. Used both to render the tree view's flat branch list and to
 * compute a branch's 1-based position for the status bar indicator
 * (bottom = 1).
 */
export function topoOrder(root: string, childrenOf: Map<string, string[]>): string[] {
  const order: string[] = [];
  const visit = (branch: string, seen: Set<string>) => {
    if (seen.has(branch)) {
      // Defensive: a cycle should never occur (parents are always an
      // earlier/ancestor commit), but guard against corrupt stored state.
      return;
    }
    seen.add(branch);
    order.push(branch);
    for (const child of childrenOf.get(branch) ?? []) {
      visit(child, seen);
    }
  };
  visit(root, new Set());
  return order;
}

/** Finds the stack (as a bottom-to-top ordered branch list) containing `branch`, if any. */
export function findStackContaining(branch: string, forest: StackForest): string[] | undefined {
  if (!forest.parentOf.has(branch) && !forest.childrenOf.has(branch)) {
    return undefined;
  }
  let root = branch;
  while (forest.parentOf.has(root)) {
    root = forest.parentOf.get(root) as string;
  }
  const order = topoOrder(root, forest.childrenOf);
  return order.length > 1 ? order : undefined;
}
