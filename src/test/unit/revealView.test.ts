import * as assert from 'assert';

import { RevealViewDeps, revealViewWith, waitUntilVisible } from '../../utils/revealView';

const viewId = 'git-smart-checkout.stacks';
const containerId = 'git-smart-checkout';
const focusCommand = `${viewId}.focus`;
const containerCommand = `workbench.view.extension.${containerId}`;

interface Harness {
  deps: RevealViewDeps;
  executed: string[];
  calls: { providerShow: number };
}

/**
 * Builds deps over a fake workbench.
 *
 * `revealedBy` names the commands (or `'provider'`) that put the view on
 * screen; anything else runs without revealing it, which is the failure this
 * ladder exists for — a focus command that resolves and shows nothing.
 * `missingCommands` are the ones that reject with "command not found".
 */
function harness(options: {
  revealedBy?: readonly string[];
  missingCommands?: readonly string[];
  providerResolved?: boolean;
}): Harness {
  const revealedBy = options.revealedBy ?? [];
  const missingCommands = options.missingCommands ?? [];
  const executed: string[] = [];
  const calls = { providerShow: 0 };
  let visible = false;

  return {
    executed,
    calls,
    deps: {
      executeCommand: async (command) => {
        if (missingCommands.includes(command)) {
          throw new Error(`command '${command}' not found`);
        }
        executed.push(command);
        if (revealedBy.includes(command)) {
          visible = true;
        }
      },
      showFromProvider: () => {
        calls.providerShow++;
        if (!options.providerResolved) {
          return false;
        }
        if (revealedBy.includes('provider')) {
          visible = true;
        }
        return true;
      },
      waitUntilVisible: async () => visible,
      log: () => undefined,
    },
  };
}

describe('revealViewWith', () => {
  it('reveals through the workbench focus command and stops there', async () => {
    const { deps, executed, calls } = harness({ revealedBy: [focusCommand] });

    assert.strictEqual(await revealViewWith(viewId, containerId, deps), true);
    assert.deepStrictEqual(executed, [focusCommand]);
    assert.strictEqual(calls.providerShow, 0);
  });

  it('never leaves the user on the container when the focus command is missing', async () => {
    // The container command restores whichever view was last active there, so
    // reaching for it without a follow-up focus answers "show me Stacks" with
    // some other view.
    const { deps, executed } = harness({
      missingCommands: [focusCommand],
      revealedBy: [],
    });

    assert.strictEqual(await revealViewWith(viewId, containerId, deps), false);
    assert.deepStrictEqual(executed, [containerCommand]);
  });

  it('retries the focus command once the container is on screen', async () => {
    // The workbench registers the focus action as the view descriptor lands in
    // a located container, so the retry is what actually reveals the view here.
    let containerOpened = false;
    const executed: string[] = [];
    let visible = false;

    const deps: RevealViewDeps = {
      executeCommand: async (command) => {
        if (command === containerCommand) {
          containerOpened = true;
          executed.push(command);
          return;
        }
        if (command === focusCommand && !containerOpened) {
          throw new Error(`command '${command}' not found`);
        }
        executed.push(command);
        visible = true;
      },
      showFromProvider: () => false,
      waitUntilVisible: async () => visible,
      log: () => undefined,
    };

    assert.strictEqual(await revealViewWith(viewId, containerId, deps), true);
    assert.deepStrictEqual(executed, [containerCommand, focusCommand]);
  });

  it('falls back to the provider handle when the focus command reveals nothing', async () => {
    const harnessed = harness({
      revealedBy: ['provider'],
      providerResolved: true,
    });

    assert.strictEqual(await revealViewWith(viewId, containerId, harnessed.deps), true);
    assert.deepStrictEqual(harnessed.executed, [focusCommand]);
    assert.strictEqual(harnessed.calls.providerShow, 1);
  });

  it('skips the provider handle when the view has never been resolved', async () => {
    const harnessed = harness({
      revealedBy: [containerCommand],
      providerResolved: false,
    });

    assert.strictEqual(await revealViewWith(viewId, containerId, harnessed.deps), true);
    assert.deepStrictEqual(harnessed.executed, [focusCommand, containerCommand, focusCommand]);
  });

  it('reports failure when nothing puts the view on screen', async () => {
    const { deps, executed } = harness({ revealedBy: [] });

    assert.strictEqual(await revealViewWith(viewId, containerId, deps), false);
    assert.deepStrictEqual(executed, [focusCommand, containerCommand, focusCommand]);
  });
});

describe('waitUntilVisible', () => {
  it('returns as soon as the view reports visible', async () => {
    let calls = 0;

    assert.strictEqual(
      await waitUntilVisible(() => {
        calls++;
        return true;
      }),
      true
    );
    assert.strictEqual(calls, 1);
  });

  it('polls while the view is still hidden — visibility arrives asynchronously', async () => {
    let calls = 0;

    assert.strictEqual(
      await waitUntilVisible(() => {
        calls++;
        return calls > 2;
      }),
      true
    );
    assert.ok(calls >= 3, `expected repeated polling, got ${calls} call(s)`);
  });

  it('gives up and reports hidden when the view never appears', async () => {
    assert.strictEqual(await waitUntilVisible(() => false), false);
  });
});
