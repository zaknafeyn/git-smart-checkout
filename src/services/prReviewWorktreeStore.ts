import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { LoggingService } from '../logging/loggingService';

export interface PRReviewWorktreeRecord {
  id: string;
  repoKey: string;
  repositoryPath: string;
  owner?: string;
  repo?: string;
  worktreePath: string;
  branchName: string;
  prNumber: number;
  prTitle: string;
  prUrl: string;
  createdAt: string;
  headSha?: string;
}

export interface PRReviewWorktreeRepoIdentity {
  repoKey: string;
  repositoryPath: string;
}

export type PRReviewWorktreeRecordInput = Omit<PRReviewWorktreeRecord, 'id' | 'repoKey' | 'createdAt'> & {
  repoKey?: string;
  createdAt?: string;
};

interface PRReviewWorktreeStorageState {
  version: 1;
  records: PRReviewWorktreeRecord[];
}

const STORAGE_KEY = 'prReviewWorktrees.v1';

export class PRReviewWorktreeStore {
  constructor(
    private readonly storage?: Pick<vscode.Memento, 'get' | 'update'>,
    private readonly logService?: LoggingService
  ) {}

  static createRepoKey(
    owner: string | undefined,
    repo: string | undefined,
    repositoryPath: string
  ): string {
    return owner && repo ? `${owner}/${repo}` : path.resolve(repositoryPath);
  }

  async upsert(record: PRReviewWorktreeRecordInput): Promise<void> {
    if (!this.storage) {
      return;
    }

    const state = this.getState();
    const repoKey = record.repoKey ??
      PRReviewWorktreeStore.createRepoKey(record.owner, record.repo, record.repositoryPath);
    const id = this.createId(repoKey, record.worktreePath);
    const existing = state.records.find((item) => item.id === id);
    const nextRecord: PRReviewWorktreeRecord = {
      ...record,
      id,
      repoKey,
      createdAt: existing?.createdAt ?? record.createdAt ?? new Date().toISOString(),
    };

    const records = existing
      ? state.records.map((item) => (item.id === id ? nextRecord : item))
      : [...state.records, nextRecord];

    await this.updateState({ version: 1, records });
  }

  async getForRepository(identity: PRReviewWorktreeRepoIdentity): Promise<PRReviewWorktreeRecord[]> {
    if (!this.storage) {
      return [];
    }

    return this.getState().records.filter((record) => this.matchesRepository(record, identity));
  }

  async remove(recordId: string): Promise<void> {
    if (!this.storage) {
      return;
    }

    const state = this.getState();
    await this.updateState({
      version: 1,
      records: state.records.filter((record) => record.id !== recordId),
    });
  }

  async removeMissingForRepository(
    identity: PRReviewWorktreeRepoIdentity,
    existingWorktreePaths: string[]
  ): Promise<void> {
    if (!this.storage) {
      return;
    }

    const state = this.getState();
    const records = state.records.filter((record) => {
      if (!this.matchesRepository(record, identity)) {
        return true;
      }

      return existingWorktreePaths.some((worktreePath) =>
        this.isSamePath(record.worktreePath, worktreePath)
      );
    });

    if (records.length !== state.records.length) {
      await this.updateState({ version: 1, records });
    }
  }

  private getState(): PRReviewWorktreeStorageState {
    try {
      const state = this.storage?.get<PRReviewWorktreeStorageState>(STORAGE_KEY);
      if (state?.version === 1 && Array.isArray(state.records)) {
        return state;
      }
    } catch (error) {
      this.logService?.warn(`Failed to read PR review worktree records: ${error}`);
    }

    return { version: 1, records: [] };
  }

  private async updateState(state: PRReviewWorktreeStorageState): Promise<void> {
    try {
      await this.storage?.update(STORAGE_KEY, state);
    } catch (error) {
      this.logService?.warn(`Failed to update PR review worktree records: ${error}`);
    }
  }

  private createId(repoKey: string, worktreePath: string): string {
    return `${repoKey}:${this.normalizePathForComparison(worktreePath)}`;
  }

  private matchesRepository(
    record: PRReviewWorktreeRecord,
    identity: PRReviewWorktreeRepoIdentity
  ): boolean {
    return record.repoKey === identity.repoKey ||
      this.isSamePath(record.repositoryPath, identity.repositoryPath);
  }

  private isSamePath(left: string, right: string): boolean {
    return this.normalizePathForComparison(left) === this.normalizePathForComparison(right);
  }

  private normalizePathForComparison(targetPath: string): string {
    try {
      return fs.realpathSync.native(targetPath);
    } catch {
      try {
        return path.join(
          fs.realpathSync.native(path.dirname(targetPath)),
          path.basename(targetPath)
        );
      } catch {
        return path.resolve(targetPath);
      }
    }
  }
}
