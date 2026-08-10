import * as vscode from 'vscode';

import { LoggingService } from '../logging/loggingService';

/**
 * Delays, in milliseconds, before each probe attempt. The first probe is immediate; the rest
 * back off so a workbench that is still processing contributions gets a chance to catch up
 * without holding activation for long when the view genuinely never appears.
 */
const PROBE_DELAYS_MS = [0, 100, 250, 500, 1000, 2000];

export interface CreateTreeViewDeps {
  getCommands: (filterInternal: boolean) => Thenable<string[]>;
  createTreeView: <T>(viewId: string, options: vscode.TreeViewOptions<T>) => vscode.TreeView<T>;
  delay: (ms: number) => Promise<void>;
}

const defaultDeps: CreateTreeViewDeps = {
  getCommands: (filterInternal) => vscode.commands.getCommands(filterInternal),
  createTreeView: (viewId, options) => vscode.window.createTreeView(viewId, options),
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * `vscode.window.createTreeView` for a view id the workbench does not know about does not throw —
 * it makes the main thread pop an unactionable `No view is registered with id: <id>` error
 * notification, which no try/catch on our side can intercept. That happens whenever this window's
 * view registry doesn't (yet) hold our `contributes.views` entry: the extension host re-registering
 * or restarting, or an activation racing the processing of contributions.
 *
 * So probe first, and only create the view once the workbench admits it exists. The probe is the
 * auto-registered `<viewId>.focus` command: VS Code registers one per **registered** view
 * descriptor (alongside `.open` / `.resetViewLocation`), independent of the view's `when` clause,
 * so its presence in the command list is the only in-process signal that the descriptor is live.
 *
 * @returns the created view, or `undefined` if the contribution never showed up — in which case
 * nothing is created, deliberately: calling through anyway is exactly what produces the raw error.
 */
export async function createTreeViewWhenContributed<T>(
  viewId: string,
  options: vscode.TreeViewOptions<T>,
  logService: LoggingService,
  deps: CreateTreeViewDeps = defaultDeps
): Promise<vscode.TreeView<T> | undefined> {
  for (const delayMs of PROBE_DELAYS_MS) {
    if (delayMs > 0) {
      await deps.delay(delayMs);
    }

    const commands = await deps.getCommands(true);
    if (commands.includes(`${viewId}.focus`)) {
      return deps.createTreeView<T>(viewId, options);
    }
  }

  logService.warn(
    `View "${viewId}" is not registered in this window, so it was not created. ` +
      'Reload the window (Developer: Reload Window) to restore it.'
  );
  return undefined;
}
