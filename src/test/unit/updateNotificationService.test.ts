import * as assert from 'assert';
import * as vscode from 'vscode';

import {
  CHECKOUT_SUCCESS_COUNT_KEY,
  FEEDBACK_STATE_KEY,
  FeedbackState,
  LAST_SEEN_VERSION_KEY,
  UpdateNotificationService,
} from '../../services/updateNotificationService';

/** Minimal in-memory `vscode.Memento` fake for globalState. */
class FakeMemento implements vscode.Memento {
  private store = new Map<string, unknown>();

  keys(): readonly string[] {
    return [...this.store.keys()];
  }

  get<T>(key: string, defaultValue?: T): T {
    return (this.store.has(key) ? this.store.get(key) : defaultValue) as T;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.store.delete(key);
    } else {
      this.store.set(key, value);
    }
  }
}

function makeContext(version: string, globalState = new FakeMemento()): vscode.ExtensionContext {
  return {
    extension: { packageJSON: { version } },
    globalState,
  } as unknown as vscode.ExtensionContext;
}

/** Stubs `vscode.window.showInformationMessage` and `vscode.env.openExternal`, restoring both on `restore()`. */
function stubUi(respondWith: string | undefined) {
  const originalShowInformationMessage = vscode.window.showInformationMessage;
  const originalOpenExternal = vscode.env.openExternal;
  const shownMessages: string[] = [];
  const openedUrls: string[] = [];

  (vscode.window as any).showInformationMessage = async (message: string) => {
    shownMessages.push(message);
    return respondWith;
  };
  (vscode.env as any).openExternal = async (uri: vscode.Uri) => {
    openedUrls.push(uri.toString());
    return true;
  };

  return {
    shownMessages,
    openedUrls,
    restore: () => {
      (vscode.window as any).showInformationMessage = originalShowInformationMessage;
      (vscode.env as any).openExternal = originalOpenExternal;
    },
  };
}

describe('UpdateNotificationService', () => {
  describe('what\'s-new toast — version matrix', () => {
    it('stores the version silently on first install (no previous version stored)', async () => {
      const context = makeContext('1.2.0');
      const ui = stubUi(undefined);
      try {
        await new UpdateNotificationService().checkOnActivation(context, 'minor');
        assert.deepStrictEqual(ui.shownMessages, []);
        assert.strictEqual(context.globalState.get(LAST_SEEN_VERSION_KEY), '1.2.0');
      } finally {
        ui.restore();
      }
    });

    it('shows nothing when the stored version equals the current version', async () => {
      const globalState = new FakeMemento();
      await globalState.update(LAST_SEEN_VERSION_KEY, '1.2.0');
      const context = makeContext('1.2.0', globalState);
      const ui = stubUi(undefined);
      try {
        await new UpdateNotificationService().checkOnActivation(context, 'minor');
        assert.deepStrictEqual(ui.shownMessages, []);
      } finally {
        ui.restore();
      }
    });

    it('shows nothing for a patch bump when mode is "minor"', async () => {
      const globalState = new FakeMemento();
      await globalState.update(LAST_SEEN_VERSION_KEY, '1.2.0');
      const context = makeContext('1.2.1', globalState);
      const ui = stubUi(undefined);
      try {
        await new UpdateNotificationService().checkOnActivation(context, 'minor');
        assert.deepStrictEqual(ui.shownMessages, []);
      } finally {
        ui.restore();
      }
    });

    it('shows the toast for a minor bump when mode is "minor"', async () => {
      const globalState = new FakeMemento();
      await globalState.update(LAST_SEEN_VERSION_KEY, '1.2.0');
      const context = makeContext('1.3.0', globalState);
      const ui = stubUi(undefined);
      try {
        await new UpdateNotificationService().checkOnActivation(context, 'minor');
        assert.strictEqual(ui.shownMessages.length, 1);
        assert.match(ui.shownMessages[0], /updated to v1\.3\.0/);
      } finally {
        ui.restore();
      }
    });

    it('shows the toast for a major bump when mode is "minor"', async () => {
      const globalState = new FakeMemento();
      await globalState.update(LAST_SEEN_VERSION_KEY, '1.2.0');
      const context = makeContext('2.0.0', globalState);
      const ui = stubUi(undefined);
      try {
        await new UpdateNotificationService().checkOnActivation(context, 'minor');
        assert.strictEqual(ui.shownMessages.length, 1);
      } finally {
        ui.restore();
      }
    });

    it('shows nothing when mode is "never", even for a major bump', async () => {
      const globalState = new FakeMemento();
      await globalState.update(LAST_SEEN_VERSION_KEY, '1.2.0');
      const context = makeContext('2.0.0', globalState);
      const ui = stubUi(undefined);
      try {
        await new UpdateNotificationService().checkOnActivation(context, 'never');
        assert.deepStrictEqual(ui.shownMessages, []);
      } finally {
        ui.restore();
      }
    });

    it('shows the toast for a patch bump when mode is "always"', async () => {
      const globalState = new FakeMemento();
      await globalState.update(LAST_SEEN_VERSION_KEY, '1.2.0');
      const context = makeContext('1.2.1', globalState);
      const ui = stubUi(undefined);
      try {
        await new UpdateNotificationService().checkOnActivation(context, 'always');
        assert.strictEqual(ui.shownMessages.length, 1);
      } finally {
        ui.restore();
      }
    });

    it('always ends with lastSeenVersion equal to current, even when the toast is ignored/dismissed', async () => {
      const globalState = new FakeMemento();
      await globalState.update(LAST_SEEN_VERSION_KEY, '1.2.0');
      const context = makeContext('1.3.0', globalState);
      const ui = stubUi('Dismiss');
      try {
        await new UpdateNotificationService().checkOnActivation(context, 'minor');
        assert.strictEqual(context.globalState.get(LAST_SEEN_VERSION_KEY), '1.3.0');
      } finally {
        ui.restore();
      }
    });

    it('opens the changelog anchor for the exact current version when "See what\'s new" is chosen', async () => {
      const globalState = new FakeMemento();
      await globalState.update(LAST_SEEN_VERSION_KEY, '1.2.0');
      const context = makeContext('1.3.0', globalState);
      const ui = stubUi("See what's new");
      try {
        await new UpdateNotificationService().checkOnActivation(context, 'minor');
        assert.strictEqual(ui.openedUrls.length, 1);
        assert.ok(ui.openedUrls[0].includes('v1.3.0'), `expected URL to reference v1.3.0, got ${ui.openedUrls[0]}`);
      } finally {
        ui.restore();
      }
    });
  });

  describe('feedback ask — checkout counter', () => {
    function contextWithCount(count: number, feedbackState?: FeedbackState): vscode.ExtensionContext {
      const globalState = new FakeMemento();
      // Same, non-first-install version so the what's-new path never fires.
      globalState.update(LAST_SEEN_VERSION_KEY, '1.0.0');
      globalState.update(CHECKOUT_SUCCESS_COUNT_KEY, count);
      if (feedbackState) {
        globalState.update(FEEDBACK_STATE_KEY, feedbackState);
      }
      return makeContext('1.0.0', globalState);
    }

    it('shows nothing at 29 successful checkouts', async () => {
      const context = contextWithCount(29);
      const ui = stubUi(undefined);
      try {
        await new UpdateNotificationService().checkOnActivation(context, 'minor');
        assert.deepStrictEqual(ui.shownMessages, []);
      } finally {
        ui.restore();
      }
    });

    it('shows the feedback ask at 30 successful checkouts', async () => {
      const context = contextWithCount(30);
      const ui = stubUi(undefined);
      try {
        await new UpdateNotificationService().checkOnActivation(context, 'minor');
        assert.strictEqual(ui.shownMessages.length, 1);
        assert.match(ui.shownMessages[0], /Enjoying Git Smart Checkout/);
      } finally {
        ui.restore();
      }
    });

    it('"Later" re-arms the ask at count + 30', async () => {
      const context = contextWithCount(30);
      const ui = stubUi('Later');
      try {
        await new UpdateNotificationService().checkOnActivation(context, 'minor');
        assert.strictEqual(context.globalState.get(FEEDBACK_STATE_KEY), 'later:60');
      } finally {
        ui.restore();
      }
    });

    it('"Never" permanently suppresses the ask, even at 1000 checkouts', async () => {
      const context = contextWithCount(1000, 'never');
      const ui = stubUi(undefined);
      try {
        await new UpdateNotificationService().checkOnActivation(context, 'minor');
        assert.deepStrictEqual(ui.shownMessages, []);
      } finally {
        ui.restore();
      }
    });

    it('"Rate it" opens the marketplace review URL and suppresses future asks', async () => {
      const context = contextWithCount(30);
      const ui = stubUi('Rate it');
      try {
        await new UpdateNotificationService().checkOnActivation(context, 'minor');
        assert.strictEqual(ui.openedUrls.length, 1);
        assert.strictEqual(new URL(ui.openedUrls[0]).hostname, 'marketplace.visualstudio.com');
        assert.strictEqual(context.globalState.get(FEEDBACK_STATE_KEY), 'never');
      } finally {
        ui.restore();
      }
    });
  });

  describe('mutual exclusion', () => {
    it('only fires the what\'s-new toast when a version bump and a met counter coincide in the same activation', async () => {
      const globalState = new FakeMemento();
      await globalState.update(LAST_SEEN_VERSION_KEY, '1.2.0');
      await globalState.update(CHECKOUT_SUCCESS_COUNT_KEY, 30);
      const context = makeContext('1.3.0', globalState);
      const ui = stubUi(undefined);
      try {
        await new UpdateNotificationService().checkOnActivation(context, 'minor');
        assert.strictEqual(ui.shownMessages.length, 1);
        assert.match(ui.shownMessages[0], /updated to v1\.3\.0/);
      } finally {
        ui.restore();
      }
    });

    it('fires the feedback ask on the next activation (same version) after a what\'s-new toast consumed the session', async () => {
      const globalState = new FakeMemento();
      await globalState.update(LAST_SEEN_VERSION_KEY, '1.2.0');
      await globalState.update(CHECKOUT_SUCCESS_COUNT_KEY, 30);
      const context = makeContext('1.3.0', globalState);
      const ui = stubUi(undefined);
      try {
        const service = new UpdateNotificationService();
        await service.checkOnActivation(context, 'minor');
        assert.strictEqual(ui.shownMessages.length, 1, 'first activation shows only the what\'s-new toast');

        // "Next activation" == a fresh service instance (shownThisSession resets), same stored version.
        const nextActivationContext = makeContext('1.3.0', globalState);
        await new UpdateNotificationService().checkOnActivation(nextActivationContext, 'minor');
        assert.strictEqual(ui.shownMessages.length, 2, 'second activation shows the feedback ask');
        assert.match(ui.shownMessages[1], /Enjoying Git Smart Checkout/);
      } finally {
        ui.restore();
      }
    });
  });

  describe('recordStashCarryingCheckoutSuccess', () => {
    it('increments the checkout success counter', async () => {
      const context = makeContext('1.0.0');
      const service = new UpdateNotificationService();
      await service.recordStashCarryingCheckoutSuccess(context);
      await service.recordStashCarryingCheckoutSuccess(context);
      assert.strictEqual(context.globalState.get(CHECKOUT_SUCCESS_COUNT_KEY), 2);
    });
  });
});
