import * as assert from 'assert';
import * as vscode from 'vscode';

import { PrCloneService } from '../../services/prCloneService';
import { GitHubCommit } from '../../types/dataTypes';
import { WebviewCommand } from '../../types/webviewCommands';
import { PrCommitsWebViewProvider } from '../../view/PrCommitsWebViewProvider';
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

function makeContext(): vscode.ExtensionContext {
  return {
    workspaceState: makeMemento(),
    extensionUri: vscode.Uri.file(__dirname),
  } as unknown as vscode.ExtensionContext;
}

function makePrCloneService(): PrCloneService {
  return {
    addCleanUpActions: () => {},
  } as unknown as PrCloneService;
}

type Listener<T> = (arg: T) => void;

/**
 * A mock WebviewView whose `onDidReceiveMessage` / `onDidChangeVisibility`
 * behave like the real VS Code Event API: every registration is tracked
 * independently and returns a Disposable that removes just that listener.
 * This lets tests prove that a re-resolve disposes the previous listeners
 * instead of merely overwriting a single field.
 */
function makeMockWebviewView() {
  const messageListeners: Listener<unknown>[] = [];
  const visibilityListeners: Listener<void>[] = [];
  const posted: unknown[] = [];

  const webviewView = {
    visible: true,
    webview: {
      options: undefined as unknown,
      html: '',
      postMessage: (message: unknown) => {
        posted.push(message);
        return Promise.resolve(true);
      },
      onDidReceiveMessage: (listener: Listener<unknown>) => {
        messageListeners.push(listener);
        return {
          dispose: () => {
            const index = messageListeners.indexOf(listener);
            if (index >= 0) {
              messageListeners.splice(index, 1);
            }
          },
        };
      },
    },
    onDidChangeVisibility: (listener: Listener<void>) => {
      visibilityListeners.push(listener);
      return {
        dispose: () => {
          const index = visibilityListeners.indexOf(listener);
          if (index >= 0) {
            visibilityListeners.splice(index, 1);
          }
        },
      };
    },
  };

  return { webviewView, messageListeners, visibilityListeners, posted };
}

function makeCommit(sha: string): GitHubCommit {
  return {
    sha,
    parents: [],
    commit: { message: `Commit ${sha}` },
  } as unknown as GitHubCommit;
}

describe('PrCommitsWebViewProvider', () => {
  it('disposes listeners from the previous resolve so a re-resolve does not stack handlers', () => {
    const provider = new PrCommitsWebViewProvider(makeContext(), mockLogService, makePrCloneService());
    const { webviewView, messageListeners, visibilityListeners } = makeMockWebviewView();

    // Simulate VS Code re-invoking resolveWebviewView when a collapsed view
    // is re-expanded.
    provider.resolveWebviewView(webviewView as unknown as vscode.WebviewView);
    provider.resolveWebviewView(webviewView as unknown as vscode.WebviewView);

    assert.strictEqual(
      messageListeners.length,
      1,
      'expected exactly one onDidReceiveMessage listener to remain registered after re-resolve'
    );
    assert.strictEqual(
      visibilityListeners.length,
      1,
      'expected exactly one onDidChangeVisibility listener to remain registered after re-resolve'
    );
  });

  it('handles a TOGGLE_COMMIT message exactly once after resolving twice', async () => {
    const provider = new PrCommitsWebViewProvider(makeContext(), mockLogService, makePrCloneService());
    const { webviewView, messageListeners, posted } = makeMockWebviewView();

    provider.resolveWebviewView(webviewView as unknown as vscode.WebviewView);
    provider.resolveWebviewView(webviewView as unknown as vscode.WebviewView);

    provider.updateCommits([makeCommit('abc123')]);
    // updateCommits auto-selects non-merge commits.
    assert.deepStrictEqual(provider.getSelectedCommits(), ['abc123']);

    posted.length = 0;

    // Simulate VS Code firing the message event exactly once. If a stale
    // listener from the first resolve were still registered, this single
    // emission would invoke the handler twice, toggling the commit back to
    // its original state and posting UPDATE_COMMITS twice.
    await Promise.all(
      messageListeners.map((listener) =>
        listener({ command: WebviewCommand.TOGGLE_COMMIT, sha: 'abc123' })
      )
    );

    assert.deepStrictEqual(
      provider.getSelectedCommits(),
      [],
      'expected the commit to be toggled off exactly once'
    );

    const updateCommitsMessages = posted.filter(
      (message: any) => message.command === WebviewCommand.UPDATE_COMMITS
    );
    assert.strictEqual(
      updateCommitsMessages.length,
      1,
      'expected exactly one UPDATE_COMMITS message to be posted for a single TOGGLE_COMMIT'
    );
  });

  it('disposes tracked listeners when the provider itself is disposed', () => {
    const provider = new PrCommitsWebViewProvider(makeContext(), mockLogService, makePrCloneService());
    const { webviewView, messageListeners, visibilityListeners } = makeMockWebviewView();

    provider.resolveWebviewView(webviewView as unknown as vscode.WebviewView);
    assert.strictEqual(messageListeners.length, 1);
    assert.strictEqual(visibilityListeners.length, 1);

    provider.dispose();

    assert.strictEqual(messageListeners.length, 0);
    assert.strictEqual(visibilityListeners.length, 0);
  });
});
