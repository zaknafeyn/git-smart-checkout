import * as assert from 'assert';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { OpenWorktreeDevTerminalCommand } from '../../commands/openWorktreeDevTerminalCommand';
import { GitExecutor } from '../../common/git/gitExecutor';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';

import { createTestRepo, TestRepo } from './helpers/gitTestRepo';
import { mockLogService } from './helpers/mockLogService';

interface CreatedTerminal {
  options: vscode.TerminalOptions;
  shown: boolean;
}

class TestableOpenWorktreeDevTerminalCommand extends OpenWorktreeDevTerminalCommand {
  constructor(private readonly testGit: GitExecutor) {
    super(mockLogService, undefined);
  }

  protected async getGitExecutor(_provider?: VscodeGitProvider): Promise<GitExecutor> {
    return this.testGit;
  }
}

function stubCreateTerminal(created: CreatedTerminal[]): () => void {
  const original = vscode.window.createTerminal.bind(vscode.window);

  (vscode.window as any).createTerminal = (options: vscode.TerminalOptions) => {
    const record: CreatedTerminal = { options, shown: false };
    created.push(record);
    return {
      show() {
        record.shown = true;
      },
      dispose() {
        return undefined;
      },
    } as unknown as vscode.Terminal;
  };

  return () => {
    (vscode.window as any).createTerminal = original;
  };
}

function stubShowQuickPick(
  pick: (items: readonly vscode.QuickPickItem[]) => vscode.QuickPickItem | undefined
): { calls: number; restore: () => void } {
  const original = vscode.window.showQuickPick.bind(vscode.window);
  const state = { calls: 0 };

  (vscode.window as any).showQuickPick = async (items: readonly vscode.QuickPickItem[]) => {
    state.calls += 1;
    return pick(items);
  };

  return {
    get calls() {
      return state.calls;
    },
    restore() {
      (vscode.window as any).showQuickPick = original;
    },
  };
}

function addWorktree(repo: TestRepo, branch: string): string {
  const worktreePath = fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-worktree-'));
  // mkdtemp creates the directory, but `git worktree add` needs a missing path.
  fs.rmSync(worktreePath, { recursive: true, force: true });
  execSync(`git worktree add "${worktreePath}" ${branch}`, { cwd: repo.repoPath, stdio: 'pipe' });
  return worktreePath;
}

describe('OpenWorktreeDevTerminalCommand', () => {
  let repo: TestRepo;
  const extraWorktrees: string[] = [];

  afterEach(() => {
    for (const worktreePath of extraWorktrees) {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }
    extraWorktrees.length = 0;
    repo?.cleanup();
  });

  it('opens a terminal in the repo root without prompting when there is a single worktree', async () => {
    repo = createTestRepo();
    const created: CreatedTerminal[] = [];
    const restoreTerminal = stubCreateTerminal(created);
    const quickPick = stubShowQuickPick(() => undefined);

    try {
      const sut = new TestableOpenWorktreeDevTerminalCommand(repo.git);
      await sut.execute();
    } finally {
      quickPick.restore();
      restoreTerminal();
    }

    assert.strictEqual(quickPick.calls, 0, 'should not prompt for a single worktree');
    assert.strictEqual(created.length, 1);
    assert.strictEqual(created[0].options.cwd, repo.repoPath);
    assert.ok(created[0].shown, 'terminal should be shown');
  });

  it('opens a terminal in the selected worktree directory when multiple worktrees exist', async () => {
    repo = createTestRepo();
    const worktreePath = addWorktree(repo, repo.featureBranch);
    extraWorktrees.push(worktreePath);

    const created: CreatedTerminal[] = [];
    const restoreTerminal = stubCreateTerminal(created);
    // The current worktree is marked and sorted first; pick the other one.
    const quickPick = stubShowQuickPick((items) =>
      items.find((item) => !item.label.includes('(current)'))
    );

    try {
      const sut = new TestableOpenWorktreeDevTerminalCommand(repo.git);
      await sut.execute();
    } finally {
      quickPick.restore();
      restoreTerminal();
    }

    assert.strictEqual(quickPick.calls, 1, 'should prompt to select a worktree');
    assert.strictEqual(created.length, 1);
    // git reports canonicalized worktree paths, so compare resolved paths.
    assert.strictEqual(
      fs.realpathSync.native(String(created[0].options.cwd)),
      fs.realpathSync.native(worktreePath)
    );
    assert.ok(created[0].shown, 'terminal should be shown');
  });

  it('does not open a terminal when the worktree selection is cancelled', async () => {
    repo = createTestRepo();
    const worktreePath = addWorktree(repo, repo.featureBranch);
    extraWorktrees.push(worktreePath);

    const created: CreatedTerminal[] = [];
    const restoreTerminal = stubCreateTerminal(created);
    const quickPick = stubShowQuickPick(() => undefined);

    try {
      const sut = new TestableOpenWorktreeDevTerminalCommand(repo.git);
      await sut.execute();
    } finally {
      quickPick.restore();
      restoreTerminal();
    }

    assert.strictEqual(quickPick.calls, 1);
    assert.strictEqual(created.length, 0, 'no terminal should be created on cancel');
  });
});
