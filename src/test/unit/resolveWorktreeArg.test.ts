import * as assert from 'assert';
import * as vscode from 'vscode';

import { resolveWorktreeArg } from '../../commands/utils/resolveWorktreeArg';

describe('resolveWorktreeArg', () => {
  it('passes through a plain string path', () => {
    assert.deepStrictEqual(resolveWorktreeArg('/repo/feature', '/repo'), {
      worktreePath: '/repo/feature',
      repositoryPath: '/repo',
    });
  });

  it('extracts fsPath from a Uri', () => {
    const uri = vscode.Uri.file('/repo/feature');
    assert.deepStrictEqual(resolveWorktreeArg(uri, '/repo'), {
      worktreePath: '/repo/feature',
      repositoryPath: '/repo',
    });
  });

  it('extracts the path from a WorktreeTreeItem-shaped object, the argument VS Code actually sends for inline/context-menu commands', () => {
    const fakeTreeItem = {
      worktree: { path: '/repo/feature' },
      repositoryPath: '/repo',
      contextValue: 'worktree linked clean',
    };
    assert.deepStrictEqual(resolveWorktreeArg(fakeTreeItem), {
      worktreePath: '/repo/feature',
      repositoryPath: '/repo',
    });
  });

  it('falls back to a separately passed repositoryPath when the tree item has none', () => {
    const fakeTreeItem = { worktree: { path: '/repo/feature' } };
    assert.deepStrictEqual(resolveWorktreeArg(fakeTreeItem, '/repo'), {
      worktreePath: '/repo/feature',
      repositoryPath: '/repo',
    });
  });

  it('returns undefined for unrecognized shapes', () => {
    assert.strictEqual(resolveWorktreeArg(undefined), undefined);
    assert.strictEqual(resolveWorktreeArg(null), undefined);
    assert.strictEqual(resolveWorktreeArg(''), undefined);
    assert.strictEqual(resolveWorktreeArg(42), undefined);
    assert.strictEqual(resolveWorktreeArg({}), undefined);
    assert.strictEqual(resolveWorktreeArg({ worktree: {} }), undefined);
  });
});
