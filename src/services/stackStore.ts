import * as vscode from 'vscode';

import { LoggingService } from '../logging/loggingService';

export type StackEntrySource = 'github' | 'heuristic' | 'manual';

/**
 * A single edge in the stack forest: `branch`'s parent is `parent`. The
 * trunk (default) branch is never represented here — it's the implicit
 * root, so an entry always relates two non-trunk local branches.
 */
export interface StackEntry {
  branch: string;
  parent: string;
  /** Parent branch tip SHA the last time a restack/needs-restack check ran. */
  parentTipAtLastRestack?: string;
  source: StackEntrySource;
}

interface StackStorageState {
  version: 1;
  entries: StackEntry[];
}

const STORAGE_KEY = 'stacks.v1';

const EMPTY_STATE: StackStorageState = { version: 1, entries: [] };

/**
 * Merges freshly-detected entries (github/heuristic) with existing state,
 * preserving manual overrides untouched. A manual entry for a branch always
 * wins over a detected entry for the same branch. Pure so it's unit-testable.
 */
export function mergeStackEntries(
  existing: StackEntry[],
  detected: StackEntry[]
): StackEntry[] {
  const manualEntries = existing.filter((entry) => entry.source === 'manual');
  const manualBranches = new Set(manualEntries.map((entry) => entry.branch));
  const detectedFiltered = detected.filter((entry) => !manualBranches.has(entry.branch));
  return [...manualEntries, ...detectedFiltered];
}

/**
 * Persists the detected/manual stack forest across sessions. Modeled on
 * `PRReviewWorktreeStore`: a thin Memento wrapper over
 * `context.workspaceState` (workspaceState is already scoped per workspace,
 * so — unlike PRReviewWorktreeStore's globalState — no repo-key filtering is
 * needed here).
 */
export class StackStore {
  constructor(
    private readonly storage?: Pick<vscode.Memento, 'get' | 'update'>,
    private readonly logService?: LoggingService
  ) {}

  async getAll(): Promise<StackEntry[]> {
    return this.getState().entries;
  }

  async getForBranch(branch: string): Promise<StackEntry | undefined> {
    return this.getState().entries.find((entry) => entry.branch === branch);
  }

  /** Applies freshly-detected entries, keeping manual overrides intact. */
  async applyDetection(detected: StackEntry[]): Promise<void> {
    const state = this.getState();
    const merged = mergeStackEntries(state.entries, detected);
    await this.updateState({ version: 1, entries: merged });
  }

  /** Sets (or replaces) a manual parent override for a branch. */
  async setManualParent(branch: string, parent: string): Promise<void> {
    const state = this.getState();
    const entries = state.entries.filter((entry) => entry.branch !== branch);
    entries.push({ branch, parent, source: 'manual' });
    await this.updateState({ version: 1, entries });
  }

  /** Removes a branch's entry entirely (manual or detected). */
  async remove(branch: string): Promise<void> {
    const state = this.getState();
    const entries = state.entries.filter((entry) => entry.branch !== branch);
    if (entries.length !== state.entries.length) {
      await this.updateState({ version: 1, entries });
    }
  }

  async clear(): Promise<void> {
    await this.updateState({ version: 1, entries: [] });
  }

  private getState(): StackStorageState {
    try {
      const state = this.storage?.get<StackStorageState>(STORAGE_KEY);
      if (state?.version === 1 && Array.isArray(state.entries)) {
        return state;
      }
    } catch (error) {
      this.logService?.warn(`Failed to read stack entries: ${error}`);
    }
    return EMPTY_STATE;
  }

  private async updateState(state: StackStorageState): Promise<void> {
    try {
      await this.storage?.update(STORAGE_KEY, state);
    } catch (error) {
      this.logService?.warn(`Failed to update stack entries: ${error}`);
    }
  }
}
