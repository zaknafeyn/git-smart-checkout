import * as assert from 'assert';
import * as vscode from 'vscode';

import { StackView } from '../../services/stackModel';
import { WebviewCommand } from '../../types/webviewCommands';
import { StackWebViewProvider } from '../../view/StackWebViewProvider';
import { mockLogService } from '../e2e/helpers/mockLogService';

function makeMemento() {
  const data = new Map<string, unknown>();
  return {
    get: <T>(key: string) => data.get(key) as T,
    update: async (key: string, value: unknown) => {
      data.set(key, value);
    },
  };
}

function makeContext(memento = makeMemento()): vscode.ExtensionContext {
  return { workspaceState: memento } as unknown as vscode.ExtensionContext;
}

function makeVisibleWebviewView(messages: unknown[]) {
  return {
    visible: true,
    webview: {
      postMessage: (message: unknown) => {
        messages.push(message);
        return Promise.resolve(true);
      },
    },
  };
}

function sampleView(): StackView {
  return {
    branches: [
      {
        branch: 'feat/mid',
        isCurrent: true,
        pr: { number: 12, title: 'Mid', url: 'https://x/12', state: 'open', status: 'open', blockedDownstack: false },
      },
      {
        branch: 'feat/top',
        isCurrent: false,
        pr: { number: 52, title: 'Top', url: 'https://x/52', state: 'open', status: 'open', blockedDownstack: false },
      },
    ],
    target: 'target-branch',
    targetIsCurrent: false,
    currentIndex: 0,
    repositoryPath: '/repo',
  };
}

describe('StackWebViewProvider', () => {
  it('posts UPDATE_STACK with the exact view when the webview is visible', () => {
    const messages: unknown[] = [];
    const provider = new StackWebViewProvider(makeContext(), mockLogService, () => {});
    (provider as any).webviewView = makeVisibleWebviewView(messages);

    provider.setStack(sampleView());

    assert.deepStrictEqual(messages, [{ command: WebviewCommand.UPDATE_STACK, view: sampleView() }]);
  });

  it('posts an empty payload when there is no stack', () => {
    const messages: unknown[] = [];
    const provider = new StackWebViewProvider(makeContext(), mockLogService, () => {});
    (provider as any).webviewView = makeVisibleWebviewView(messages);

    provider.setStack(undefined);

    assert.deepStrictEqual(messages, [{ command: WebviewCommand.UPDATE_STACK, view: undefined }]);
  });

  it('does not post and does not throw when the webview is not visible', () => {
    const provider = new StackWebViewProvider(makeContext(), mockLogService, () => {});
    (provider as any).webviewView = {
      visible: false,
      webview: {
        postMessage: () => {
          throw new Error('should not be called');
        },
      },
    };

    assert.doesNotThrow(() => provider.setStack(sampleView()));
  });

  it('does not throw when there is no webview resolved yet', () => {
    const provider = new StackWebViewProvider(makeContext(), mockLogService, () => {});
    assert.doesNotThrow(() => provider.setStack(sampleView()));
  });

  it('routes STACK_CHECKOUT_BRANCH to the checkoutBranch command with the branch and repositoryPath', async () => {
    const calls: unknown[] = [];
    const originalExecuteCommand = vscode.commands.executeCommand;
    (vscode.commands as any).executeCommand = async (...args: unknown[]) => {
      calls.push(args);
    };

    try {
      const provider = new StackWebViewProvider(makeContext(), mockLogService, () => {});
      provider.setStack(sampleView());
      await (provider as any).handleCheckoutBranch('feat/top');

      assert.deepStrictEqual(calls, [
        ['git-smart-checkout.checkoutBranch', { branch: 'feat/top', repositoryPath: '/repo' }],
      ]);
    } finally {
      (vscode.commands as any).executeCommand = originalExecuteCommand;
    }
  });

  it('opens the PR URL resolved from the current stack, not a URL supplied by the message', async () => {
    const opened: string[] = [];
    const originalOpenExternal = vscode.env.openExternal;
    (vscode.env as any).openExternal = async (uri: vscode.Uri) => {
      opened.push(uri.toString());
      return true;
    };

    try {
      const provider = new StackWebViewProvider(makeContext(), mockLogService, () => {});
      provider.setStack(sampleView());
      await (provider as any).handleOpenPr(52);

      assert.deepStrictEqual(opened, ['https://x/52']);
    } finally {
      (vscode.env as any).openExternal = originalOpenExternal;
    }
  });

  it('does not open anything for an unknown PR number', async () => {
    const opened: string[] = [];
    const originalOpenExternal = vscode.env.openExternal;
    (vscode.env as any).openExternal = async (uri: vscode.Uri) => {
      opened.push(uri.toString());
      return true;
    };

    try {
      const provider = new StackWebViewProvider(makeContext(), mockLogService, () => {});
      provider.setStack(sampleView());
      await (provider as any).handleOpenPr(9999);

      assert.deepStrictEqual(opened, []);
    } finally {
      (vscode.env as any).openExternal = originalOpenExternal;
    }
  });

  it('calls onRefreshRequested for STACK_REFRESH', async () => {
    let refreshed = false;
    const provider = new StackWebViewProvider(makeContext(), mockLogService, () => {
      refreshed = true;
    });

    (provider as any).onRefreshRequested();

    assert.strictEqual(refreshed, true);
  });

  it('fetches the stack target branch via the fetchBranch command, then refreshes', async () => {
    const calls: unknown[] = [];
    const originalExecuteCommand = vscode.commands.executeCommand;
    (vscode.commands as any).executeCommand = async (...args: unknown[]) => {
      calls.push(args);
    };

    let refreshed = false;
    try {
      const provider = new StackWebViewProvider(makeContext(), mockLogService, () => {
        refreshed = true;
      });
      provider.setStack(sampleView());
      await (provider as any).handleFetchTarget();

      assert.deepStrictEqual(calls, [
        ['git-smart-checkout.fetchBranch', { branch: 'target-branch', repositoryPath: '/repo' }],
      ]);
      assert.strictEqual(refreshed, true);
    } finally {
      (vscode.commands as any).executeCommand = originalExecuteCommand;
    }
  });

  it('still refreshes when the fetch command fails', async () => {
    const originalExecuteCommand = vscode.commands.executeCommand;
    (vscode.commands as any).executeCommand = async () => {
      throw new Error('fetch failed');
    };

    let refreshed = false;
    try {
      const provider = new StackWebViewProvider(makeContext(), mockLogService, () => {
        refreshed = true;
      });
      provider.setStack(sampleView());

      await assert.doesNotReject(() => (provider as any).handleFetchTarget());
      assert.strictEqual(refreshed, true);
    } finally {
      (vscode.commands as any).executeCommand = originalExecuteCommand;
    }
  });

  it('does nothing for STACK_FETCH_TARGET when there is no current stack', async () => {
    const calls: unknown[] = [];
    const originalExecuteCommand = vscode.commands.executeCommand;
    (vscode.commands as any).executeCommand = async (...args: unknown[]) => {
      calls.push(args);
    };

    let refreshed = false;
    try {
      const provider = new StackWebViewProvider(makeContext(), mockLogService, () => {
        refreshed = true;
      });

      await (provider as any).handleFetchTarget();

      assert.deepStrictEqual(calls, []);
      assert.strictEqual(refreshed, false);
    } finally {
      (vscode.commands as any).executeCommand = originalExecuteCommand;
    }
  });

  it('restores persisted state across instances and re-posts it once visible', () => {
    const memento = makeMemento();
    const first = new StackWebViewProvider(makeContext(memento), mockLogService, () => {});
    first.setStack(sampleView());

    const messages: unknown[] = [];
    const second = new StackWebViewProvider(makeContext(memento), mockLogService, () => {});
    (second as any).webviewView = makeVisibleWebviewView(messages);
    (second as any).postStack();

    assert.deepStrictEqual(messages, [{ command: WebviewCommand.UPDATE_STACK, view: sampleView() }]);
  });
});
