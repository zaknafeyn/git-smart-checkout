import * as vscode from 'vscode';

import { LoggingService } from '../logging/loggingService';
import { GitHubPR } from '../types/dataTypes';

export interface CachedPrList {
  fetchedAt: number;
  prs: GitHubPR[];
}

interface PrCacheStorageState {
  version: 1;
  byRepo: Record<string, CachedPrList>;
}

const STORAGE_KEY = 'stacks.prCache.v1';
const EMPTY_STATE: PrCacheStorageState = { version: 1, byRepo: {} };
const DEFAULT_TTL_MS = 5 * 60_000;

/** Whether a cache entry fetched at `fetchedAt` is still usable at `now`. Pure. */
export function isPrCacheFresh(fetchedAt: number, now: number, ttlMs: number): boolean {
  return now - fetchedAt < ttlMs;
}

/**
 * Caches the raw open-PR list per repository so `StackService` can render
 * instantly on webview resolve (before the first GitHub round-trip) and can
 * fall back to a recent list when a refresh's API call fails. Modeled on
 * `StackStore`: a thin Memento wrapper over `context.workspaceState`.
 */
export class PrStackCache {
  constructor(
    private readonly storage?: Pick<vscode.Memento, 'get' | 'update'>,
    private readonly logService?: LoggingService,
    private readonly ttlMs: number = DEFAULT_TTL_MS
  ) {}

  get(repoKey: string): CachedPrList | undefined {
    return this.getState().byRepo[repoKey];
  }

  isFresh(repoKey: string, now: number = Date.now()): boolean {
    const entry = this.get(repoKey);
    return entry ? isPrCacheFresh(entry.fetchedAt, now, this.ttlMs) : false;
  }

  async set(repoKey: string, prs: GitHubPR[]): Promise<void> {
    const state = this.getState();
    const byRepo = { ...state.byRepo, [repoKey]: { fetchedAt: Date.now(), prs } };
    await this.updateState({ version: 1, byRepo });
  }

  async clear(repoKey?: string): Promise<void> {
    if (!repoKey) {
      await this.updateState({ version: 1, byRepo: {} });
      return;
    }
    const state = this.getState();
    if (!(repoKey in state.byRepo)) {
      return;
    }
    const byRepo = { ...state.byRepo };
    delete byRepo[repoKey];
    await this.updateState({ version: 1, byRepo });
  }

  private getState(): PrCacheStorageState {
    try {
      const state = this.storage?.get<PrCacheStorageState>(STORAGE_KEY);
      if (state?.version === 1 && state.byRepo && typeof state.byRepo === 'object') {
        return state;
      }
    } catch (error) {
      this.logService?.warn(`Failed to read PR stack cache: ${error}`);
    }
    return EMPTY_STATE;
  }

  private async updateState(state: PrCacheStorageState): Promise<void> {
    try {
      await this.storage?.update(STORAGE_KEY, state);
    } catch (error) {
      this.logService?.warn(`Failed to update PR stack cache: ${error}`);
    }
  }
}
