import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { GitExecutor } from '../../common/git/gitExecutor';
import { GitHubClient } from '../../common/api/ghClient';
import { LoggingService } from '../../logging/loggingService';
import { CheckoutByPRCommand } from '../../commands/checkoutByPRCommand';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { AUTO_STASH_MODE_BRANCH } from '../../configuration/extensionConfig';
import { AutoStashService } from '../../services/autoStashService';
import { GitHubPR } from '../../types/dataTypes';
import { mockLogService } from '../e2e/helpers/mockLogService';

function makeFakeGitBin(script: string[]): { fakeBin: string; gitLog: string } {
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-fake-git-'));
  const gitLog = path.join(fakeBin, 'commands.log');
  const gitPath = path.join(fakeBin, 'git');
  fs.writeFileSync(gitPath, ['#!/bin/sh', ...script, ''].join('\n'), { mode: 0o755 });
  return { fakeBin, gitLog };
}

describe('GitExecutor#fetchFromUrl', () => {
  it('forces the refspec so a second fetch succeeds after a fork force-push (non-fast-forward)', async () => {
    const { fakeBin, gitLog } = makeFakeGitBin([
      'printf "%s\\n" "$*" >> "$GSC_GIT_TEST_LOG"',
      // Simulate what real git would do: reject a non-forced non-fast-forward
      // update, but accept anything with a leading "+" (forced) refspec.
      'for arg in "$@"; do',
      '  case "$arg" in',
      '    *://*) ;;', // skip the remote URL argument, it also contains ":"
      '    *:*)',
      '      case "$arg" in',
      '        +*) exit 0 ;;',
      // Non-fast-forward rejection when the refspec is not forced.
      '        *) exit 1 ;;',
      '      esac',
      '      ;;',
      '  esac',
      'done',
      'exit 0',
    ]);
    const oldPath = process.env.PATH;
    const oldLog = process.env.GSC_GIT_TEST_LOG;
    process.env.PATH = `${fakeBin}${path.delimiter}${oldPath ?? ''}`;
    process.env.GSC_GIT_TEST_LOG = gitLog;

    try {
      const git = new GitExecutor(fakeBin, mockLogService as unknown as LoggingService);

      // Would previously fail with "non-fast-forward" on a real remote once
      // the fork branch had been force-pushed; the forced refspec fixes it.
      await git.fetchFromUrl('https://example.com/fork.git', 'pr-branch');

      assert.deepStrictEqual(
        fs.readFileSync(gitLog, 'utf8').trim().split('\n'),
        ['fetch https://example.com/fork.git +pr-branch:pr-branch']
      );
    } finally {
      process.env.PATH = oldPath;
      if (oldLog === undefined) {
        delete process.env.GSC_GIT_TEST_LOG;
      } else {
        process.env.GSC_GIT_TEST_LOG = oldLog;
      }
      fs.rmSync(fakeBin, { recursive: true, force: true });
    }
  });

  it('fetches to FETCH_HEAD (no destination ref) when told the branch is currently checked out', async () => {
    const { fakeBin, gitLog } = makeFakeGitBin([
      'printf "%s\\n" "$*" >> "$GSC_GIT_TEST_LOG"',
      'exit 0',
    ]);
    const oldPath = process.env.PATH;
    const oldLog = process.env.GSC_GIT_TEST_LOG;
    process.env.PATH = `${fakeBin}${path.delimiter}${oldPath ?? ''}`;
    process.env.GSC_GIT_TEST_LOG = gitLog;

    try {
      const git = new GitExecutor(fakeBin, mockLogService as unknown as LoggingService);

      await git.fetchFromUrl('https://example.com/fork.git', 'pr-branch', true);

      assert.deepStrictEqual(
        fs.readFileSync(gitLog, 'utf8').trim().split('\n'),
        ['fetch https://example.com/fork.git pr-branch']
      );
    } finally {
      process.env.PATH = oldPath;
      if (oldLog === undefined) {
        delete process.env.GSC_GIT_TEST_LOG;
      } else {
        process.env.GSC_GIT_TEST_LOG = oldLog;
      }
      fs.rmSync(fakeBin, { recursive: true, force: true });
    }
  });
});

function makeMockConfigManager(mode: string): ConfigurationManager {
  return { get: () => ({ mode }) } as unknown as ConfigurationManager;
}

function makeForkPR(headRef: string): GitHubPR {
  return {
    number: 99,
    title: 'Fork PR title',
    body: '',
    head: { ref: headRef, sha: 'def456', repo: { full_name: 'fork-owner/repo', clone_url: 'https://example.com/fork.git' } },
    base: { ref: 'main', repo: { full_name: 'owner/repo' } },
    html_url: 'https://github.com/owner/repo/pull/99',
    labels: [],
    assignees: [],
  } as unknown as GitHubPR;
}

function stubInputBox(value: string | undefined): () => void {
  const original = vscode.window.showInputBox.bind(vscode.window);
  (vscode.window as any).showInputBox = async () => value;
  return () => { (vscode.window as any).showInputBox = original; };
}

function stubInfoMessages(messages: string[]): () => void {
  const original = vscode.window.showInformationMessage.bind(vscode.window);
  (vscode.window as any).showInformationMessage = async (message: string) => {
    messages.push(message);
    return 'OK';
  };
  return () => { (vscode.window as any).showInformationMessage = original; };
}

describe('CheckoutByPRCommand – fork PR already checked out', () => {
  it('fetches to FETCH_HEAD and informs the user instead of failing on the current branch', async () => {
    const infoMessages: string[] = [];
    const restoreInput = stubInputBox('99');
    const restoreInfo = stubInfoMessages(infoMessages);

    let fetchArgs: [string, string, boolean | undefined] | undefined;
    let checkoutAndStashCalled = false;
    const fakeGit = {
      getRepoInfo: async () => ({ owner: 'owner', repo: 'repo' }),
      getCurrentBranch: async () => 'source', // same as PR's headRef below
      fetchFromUrl: async (remoteUrl: string, headRef: string, toFetchHead?: boolean) => {
        fetchArgs = [remoteUrl, headRef, toFetchHead];
      },
      fetchSpecificBranch: async () => { throw new Error('should not be called for a fork PR'); },
      isWorkdirHasChanges: async () => { throw new Error('should not be reached'); },
    };

    class PatchedCommand extends CheckoutByPRCommand {
      protected async getGitExecutor(): Promise<GitExecutor> { return fakeGit as unknown as GitExecutor; }
      protected createGitHubClient(): GitHubClient {
        return { fetchPullRequest: async () => makeForkPR('source') } as unknown as GitHubClient;
      }
    }

    const autoStashService = {
      getAutoStashMode: async () => { throw new Error('should not be called'); },
      checkoutAndStashChanges: async () => { checkoutAndStashCalled = true; return 'ok'; },
    } as unknown as AutoStashService;

    try {
      await new PatchedCommand(
        makeMockConfigManager(AUTO_STASH_MODE_BRANCH),
        mockLogService,
        autoStashService
      ).execute();

      assert.deepStrictEqual(fetchArgs, ['https://example.com/fork.git', 'source', true]);
      assert.ok(
        infoMessages.some((m) => m === 'You are already on the PR branch; pull skipped.'),
        `expected info message about skipped pull, got: ${JSON.stringify(infoMessages)}`
      );
      assert.strictEqual(checkoutAndStashCalled, false, 'should not attempt to checkout/stash when pull was skipped');
    } finally {
      restoreInput();
      restoreInfo();
    }
  });
});
