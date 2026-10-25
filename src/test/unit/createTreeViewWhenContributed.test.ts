import * as assert from 'assert';
import * as vscode from 'vscode';

import {
  CreateTreeViewDeps,
  createTreeViewWhenContributed,
} from '../../view/createTreeViewWhenContributed';
import { LoggingService } from '../../logging/loggingService';

const VIEW_ID = 'git-smart-checkout.stashes';

/** Commands unrelated to the view, always present, so the probe has to match precisely. */
const OTHER_COMMANDS = ['git-smart-checkout.checkoutTo', 'git-smart-checkout.stashes.refresh'];

interface Harness {
  deps: CreateTreeViewDeps;
  logService: LoggingService;
  /** One entry per `createTreeView` call, so "created at most once" is observable. */
  createdViews: string[];
  probeCount: () => number;
  delays: number[];
  warnings: string[];
}

/**
 * @param registeredAfterProbes number of probes that report the view missing before it shows up;
 * `Infinity` for a view that never gets registered.
 */
function makeHarness(registeredAfterProbes: number): Harness {
  const createdViews: string[] = [];
  const delays: number[] = [];
  const warnings: string[] = [];
  let probes = 0;

  const deps: CreateTreeViewDeps = {
    getCommands: async () => {
      const isRegistered = probes >= registeredAfterProbes;
      probes += 1;
      return isRegistered ? [...OTHER_COMMANDS, `${VIEW_ID}.focus`] : [...OTHER_COMMANDS];
    },
    createTreeView: <T>(viewId: string) => {
      createdViews.push(viewId);
      return { title: viewId } as unknown as vscode.TreeView<T>;
    },
    // Resolves immediately: the test asserts on the requested backoff, not on real waiting.
    delay: async (ms: number) => {
      delays.push(ms);
    },
  };

  const logService = {
    warn: (message: string) => warnings.push(message),
    error: () => {},
    info: () => {},
    debug: () => {},
  } as unknown as LoggingService;

  return { deps, logService, createdViews, probeCount: () => probes, delays, warnings };
}

describe('createTreeViewWhenContributed', () => {
  it('creates the view on the first probe when the contribution is already registered', async () => {
    const harness = makeHarness(0);

    const view = await createTreeViewWhenContributed(
      VIEW_ID,
      { treeDataProvider: {} as vscode.TreeDataProvider<unknown> },
      harness.logService,
      harness.deps
    );

    assert.ok(view, 'a view should be returned');
    assert.deepStrictEqual(harness.createdViews, [VIEW_ID]);
    assert.strictEqual(harness.probeCount(), 1, 'no retries are needed');
    assert.deepStrictEqual(harness.delays, [], 'activation is not delayed in the happy path');
    assert.deepStrictEqual(harness.warnings, []);
  });

  it('retries and creates the view once the contribution shows up late', async () => {
    const harness = makeHarness(3);

    const view = await createTreeViewWhenContributed(
      VIEW_ID,
      { treeDataProvider: {} as vscode.TreeDataProvider<unknown> },
      harness.logService,
      harness.deps
    );

    assert.ok(view, 'a view should be returned');
    assert.deepStrictEqual(harness.createdViews, [VIEW_ID], 'created exactly once');
    assert.strictEqual(harness.probeCount(), 4, 'three failed probes, then the successful one');
    assert.deepStrictEqual(harness.delays, [100, 250, 500], 'backs off between retries');
    assert.deepStrictEqual(harness.warnings, []);
  });

  it('never calls createTreeView, and warns, when the contribution never appears', async () => {
    const harness = makeHarness(Infinity);

    const view = await createTreeViewWhenContributed(
      VIEW_ID,
      { treeDataProvider: {} as vscode.TreeDataProvider<unknown> },
      harness.logService,
      harness.deps
    );

    assert.strictEqual(view, undefined);
    // The whole point: calling through is what makes the workbench pop
    // "No view is registered with id: ...".
    assert.deepStrictEqual(harness.createdViews, []);
    assert.strictEqual(harness.warnings.length, 1);
    assert.ok(
      harness.warnings[0].includes(VIEW_ID),
      'the warning names the view that could not be created'
    );
  });

  it('gives up after a bounded number of probes rather than retrying forever', async () => {
    const harness = makeHarness(Infinity);

    await createTreeViewWhenContributed(
      VIEW_ID,
      { treeDataProvider: {} as vscode.TreeDataProvider<unknown> },
      harness.logService,
      harness.deps
    );

    assert.strictEqual(harness.probeCount(), 6);
    assert.deepStrictEqual(harness.delays, [100, 250, 500, 1000, 2000]);
  });
});
