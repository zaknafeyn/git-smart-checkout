import * as assert from 'assert';
import * as vscode from 'vscode';

import { AUTO_STASH_AND_POP_IN_NEW_BRANCH } from '../../commands/checkoutToCommand/constants';
import { EXTENSION_NAME } from '../../const';
import { AUTO_STASH_MODE_MANUAL } from '../../configuration/extensionConfig';
import {
  CHECKOUT_SUCCESS_COUNT_KEY,
  FEEDBACK_STATE_KEY,
  LAST_SEEN_VERSION_KEY,
  UpdateNotificationService,
} from '../../services/updateNotificationService';

import {
  commandId,
  delay,
  ensureExtensionActivated,
  QuickPickLikeItem,
  setExtensionMode,
  stubCreateQuickPick,
  stubErrorMessages,
  stubInformationMessages,
  stubShowQuickPick,
  withRepoWorkspace,
} from './helpers/commandHarness';
import { createTestRepo, TestRepo } from './helpers/gitTestRepo';

interface ExtensionApi {
  context: vscode.ExtensionContext;
  updateNotificationService: UpdateNotificationService;
}

async function getExtensionApi(): Promise<ExtensionApi> {
  const extension = vscode.extensions.all.find(
    (candidate) => candidate.packageJSON?.name === EXTENSION_NAME
  );
  assert.ok(extension, `Extension ${EXTENSION_NAME} should be installed in the test host.`);
  return (await extension.activate()) as ExtensionApi;
}

function pickBranch(branchName: string): (items: readonly QuickPickLikeItem[]) => QuickPickLikeItem | undefined {
  return (items) => items.find((candidate) => candidate.ref?.name === branchName && !candidate.ref.remote && !candidate.ref.isTag);
}

/** Drives the real `checkoutTo` command with a fixed auto-stash mode, resolving once it finishes. */
async function executeCheckoutTo(branchName: string, stashMode: string): Promise<string[]> {
  const restoreQuickPick = stubCreateQuickPick(pickBranch(branchName));
  const restoreModePick = stubShowQuickPick((items, options) => {
    if (options?.placeHolder !== 'Select auto stash mode') return undefined;
    return items.find((item) => typeof item !== 'string' && item.label === stashMode) as vscode.QuickPickItem;
  });
  const errors = stubErrorMessages();

  try {
    await vscode.commands.executeCommand(commandId('checkoutTo'));
    await delay();
    return errors.messages;
  } finally {
    errors.restore();
    restoreModePick();
    restoreQuickPick();
  }
}

describe('What\'s new / feedback notifications — activation-level e2e', () => {
  before(async () => {
    await ensureExtensionActivated();
  });

  it('real activation stores lastSeenVersion equal to the running extension version', async () => {
    const { context } = await getExtensionApi();
    const current = String(context.extension.packageJSON.version);
    assert.strictEqual(context.globalState.get(LAST_SEEN_VERSION_KEY), current);
  });

  describe('version-bump toast', () => {
    it('fires the toast when the stored version is older, and updates lastSeenVersion', async () => {
      const { context } = await getExtensionApi();
      const current = String(context.extension.packageJSON.version);
      const [major, minor, patch] = current.split('.').map(Number);
      const olderVersion = `${major}.${Math.max(0, minor - 1)}.${patch}`;

      await context.globalState.update(LAST_SEEN_VERSION_KEY, olderVersion);
      const info = stubInformationMessages(() => undefined);

      try {
        await new UpdateNotificationService().checkOnActivation(context, 'minor');
        assert.strictEqual(info.messages.length, 1);
        assert.strictEqual(info.messages[0], `Git Smart Checkout updated to v${current}`);
        assert.strictEqual(context.globalState.get(LAST_SEEN_VERSION_KEY), current);
      } finally {
        info.restore();
      }
    });

    it('does not fire the toast when the stored version already equals the current version', async () => {
      const { context } = await getExtensionApi();
      const current = String(context.extension.packageJSON.version);
      await context.globalState.update(LAST_SEEN_VERSION_KEY, current);
      const info = stubInformationMessages(() => undefined);

      try {
        await new UpdateNotificationService().checkOnActivation(context, 'minor');
        assert.deepStrictEqual(info.messages, []);
      } finally {
        info.restore();
      }
    });
  });

  describe('feedback ask driven by real stash-carrying checkouts', () => {
    let repo: TestRepo;

    beforeEach(async () => {
      repo = createTestRepo();
      await setExtensionMode(AUTO_STASH_MODE_MANUAL);
    });

    afterEach(() => {
      repo.cleanup();
    });

    it('increments checkoutSuccessCount on a real stash-carrying checkout, and the feedback ask fires only on the next activation', async () => {
      const { context } = await getExtensionApi();
      const current = String(context.extension.packageJSON.version);
      // Keep lastSeenVersion pinned to current so the what's-new toast never fires here.
      await context.globalState.update(LAST_SEEN_VERSION_KEY, current);
      await context.globalState.update(CHECKOUT_SUCCESS_COUNT_KEY, 29);
      await context.globalState.update(FEEDBACK_STATE_KEY, undefined);

      await withRepoWorkspace(repo, async () => {
        repo.makeChange('file1.txt', 'dirty change for feedback counter\n');
        const errors = await executeCheckoutTo(repo.featureBranch, AUTO_STASH_AND_POP_IN_NEW_BRANCH);
        assert.deepStrictEqual(errors, []);
      });

      assert.strictEqual(
        context.globalState.get(CHECKOUT_SUCCESS_COUNT_KEY),
        30,
        'a real stash-carrying checkout through the contributed command should increment the counter'
      );

      // Mid-session: no feedback toast has fired yet as a side effect of the checkout itself.
      const infoDuringSession = stubInformationMessages(() => undefined);
      infoDuringSession.restore();

      // "Next activation": invoke checkOnActivation again (a fresh service instance, as
      // extension.ts would construct on a real reload), same version so what's-new is silent.
      const info = stubInformationMessages(() => undefined);
      try {
        await new UpdateNotificationService().checkOnActivation(context, 'minor');
        assert.strictEqual(info.messages.length, 1, 'feedback ask should fire once the threshold is reached');
        assert.match(info.messages[0], /Enjoying Git Smart Checkout/);
      } finally {
        info.restore();
      }
    });

    it('does not increment checkoutSuccessCount when the checkout is cancelled (branch picker dismissed)', async () => {
      const { context } = await getExtensionApi();
      const current = String(context.extension.packageJSON.version);
      await context.globalState.update(LAST_SEEN_VERSION_KEY, current);
      // `checkoutSuccessCount` is a real, process-wide extension counter shared across the
      // whole e2e run (not reset between test files), so assert a *delta* here rather than an
      // absolute value — an absolute assertion would be flaky against any other test file's
      // real stash-carrying checkouts landing asynchronously around this one.
      const before = context.globalState.get<number>(CHECKOUT_SUCCESS_COUNT_KEY, 0);

      await withRepoWorkspace(repo, async () => {
        repo.makeChange('file1.txt', 'dirty change, cancelled checkout\n');

        // Dismiss the branch picker: stubCreateQuickPick's `pick` returning undefined
        // simulates the user pressing Escape.
        const restoreQuickPick = stubCreateQuickPick(() => undefined);
        try {
          await vscode.commands.executeCommand(commandId('checkoutTo'));
          await delay();
        } finally {
          restoreQuickPick();
        }
      });

      assert.strictEqual(
        context.globalState.get(CHECKOUT_SUCCESS_COUNT_KEY),
        before,
        'a cancelled checkout must not increment the feedback counter'
      );
    });
  });
});
