import * as vscode from 'vscode';

import { getFullRefname } from '../common/git/refName';
import { IGitRef } from '../common/git/types';
import { LoggingService } from '../logging/loggingService';

export const REF_DETAILS_CACHE_TTL_MS = 48 * 60 * 60 * 1000;

type CachedRefDetails = Pick<
  IGitRef,
  'hash' | 'comment' | 'authorName' | 'committerDate' | 'parsedUpstreamTrack'
>;

interface RefDetailsCacheEntry {
  refHash: string;
  details: Partial<CachedRefDetails>;
  updatedAt: number;
}

interface RefDetailsCacheState {
  version: 1;
  entries: Record<string, RefDetailsCacheEntry>;
}

const STORAGE_KEY = 'refDetailsCache.v1';

export class RefDetailsCache {
  private writeQueue = Promise.resolve();

  constructor(
    private readonly storage?: Pick<vscode.Memento, 'get' | 'update'>,
    private readonly logService?: LoggingService
  ) {}

  get(repoKey: string, ref: IGitRef, now = Date.now()): Partial<IGitRef> | undefined {
    if (!this.storage) {
      return undefined;
    }

    const entry = this.getState().entries[this.createKey(repoKey, ref)];
    if (!entry) {
      return undefined;
    }

    if (now - entry.updatedAt > REF_DETAILS_CACHE_TTL_MS) {
      return undefined;
    }

    const refHash = this.getRefHash(ref);
    if (!this.hashesMatch(entry.refHash, refHash) && !this.hashesMatch(entry.details.hash, refHash)) {
      return undefined;
    }

    return { ...entry.details };
  }

  apply(repoKey: string, refs: IGitRef[], now = Date.now()): void {
    for (const ref of refs) {
      const details = this.get(repoKey, ref, now);
      if (details) {
        mergeRefDetails(ref, details);
      }
    }
  }

  async upsert(repoKey: string, ref: IGitRef, details: Partial<IGitRef>, now = Date.now()): Promise<void> {
    if (!this.storage || Object.keys(details).length === 0) {
      return;
    }

    const sanitized = this.sanitize(details);
    if (Object.keys(sanitized).length === 0) {
      return;
    }

    await this.enqueueUpdate(async () => {
      const state = this.getState();
      state.entries[this.createKey(repoKey, ref)] = {
        refHash: this.getRefHash(ref),
        details: sanitized,
        updatedAt: now,
      };
      await this.updateState(state);
    });
  }

  /**
   * Upserts many refs in a single Memento read-modify-write cycle instead of
   * one per ref — `upsert` alone would read and rewrite the entire cache
   * state for every ref, which is O(N) full-state writes for large repos.
   */
  async upsertFromRefs(repoKey: string, refs: IGitRef[], now = Date.now()): Promise<void> {
    if (!this.storage) {
      return;
    }

    const pending = refs
      .map((ref) => ({ ref, sanitized: this.sanitize(ref) }))
      .filter(({ sanitized }) => Object.keys(sanitized).length > 0);

    if (pending.length === 0) {
      return;
    }

    await this.enqueueUpdate(async () => {
      const state = this.getState();
      for (const { ref, sanitized } of pending) {
        state.entries[this.createKey(repoKey, ref)] = {
          refHash: this.getRefHash(ref),
          details: sanitized,
          updatedAt: now,
        };
      }
      await this.updateState(state);
    });
  }

  isMissing(repoKey: string, ref: IGitRef, now = Date.now()): boolean {
    return !this.get(repoKey, ref, now);
  }

  private sanitize(details: Partial<IGitRef>): Partial<CachedRefDetails> {
    const result: Partial<CachedRefDetails> = {};
    if (details.hash !== undefined) {
      result.hash = details.hash;
    }
    if (details.comment !== undefined) {
      result.comment = details.comment;
    }
    if (details.authorName !== undefined) {
      result.authorName = details.authorName;
    }
    if (details.committerDate !== undefined) {
      result.committerDate = details.committerDate;
    }
    if (details.parsedUpstreamTrack !== undefined) {
      result.parsedUpstreamTrack = details.parsedUpstreamTrack;
    }
    return result;
  }

  private getState(): RefDetailsCacheState {
    try {
      const state = this.storage?.get<RefDetailsCacheState>(STORAGE_KEY);
      if (state?.version === 1 && state.entries && typeof state.entries === 'object') {
        return { version: 1, entries: { ...state.entries } };
      }
    } catch (error) {
      this.logService?.warn(`Failed to read ref details cache: ${error}`);
    }

    return { version: 1, entries: {} };
  }

  private async updateState(state: RefDetailsCacheState): Promise<void> {
    try {
      await this.storage?.update(STORAGE_KEY, state);
    } catch (error) {
      this.logService?.warn(`Failed to update ref details cache: ${error}`);
    }
  }

  private async enqueueUpdate(update: () => Promise<void>): Promise<void> {
    const next = this.writeQueue.then(update, update);
    this.writeQueue = next.catch(() => undefined);
    await next;
  }

  private createKey(repoKey: string, ref: IGitRef): string {
    return `${repoKey}:${getFullRefname(ref)}`;
  }

  private getRefHash(ref: IGitRef): string {
    return ref.hash ?? '';
  }

  /**
   * Compares two commit hashes for cache-validity purposes. Different
   * producers may emit different SHA lengths (e.g. legacy short-SHA entries
   * persisted before hashes were normalized to full length), so hashes are
   * considered equal when one is a non-empty prefix of the other rather than
   * requiring an exact string match.
   */
  private hashesMatch(a: string | undefined, b: string | undefined): boolean {
    if (!a || !b) {
      return false;
    }
    return a.startsWith(b) || b.startsWith(a);
  }
}

export function mergeRefDetails(ref: IGitRef, details: Partial<IGitRef>): void {
  for (const [field, value] of Object.entries(details)) {
    if (value !== undefined) {
      (ref as unknown as Record<string, unknown>)[field] = value;
    }
  }
}
