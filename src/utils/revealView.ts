import { commands } from 'vscode';

/**
 * Picks the command that reveals `viewId`.
 *
 * VS Code auto-generates a `<viewId>.focus` command for every contributed view,
 * but that command is owned by the workbench, not by us: it is registered (and
 * disposed) as the view descriptor enters and leaves a *located* view container,
 * so it can be missing while the extension is updated in place, while the
 * container is being relocated, or during a reload race. Executing it blind then
 * fails with a raw `command '<viewId>.focus' not found` error in the user's face
 * and nothing opens. Opening the container is always available and lands the user
 * on the view anyway, so use it as the fallback.
 */
export function pickRevealCommand(
  viewId: string,
  viewContainerId: string,
  availableCommands: readonly string[]
): string {
  const focusCommand = `${viewId}.focus`;

  return availableCommands.includes(focusCommand)
    ? focusCommand
    : `workbench.view.extension.${viewContainerId}`;
}

/** Reveals `viewId`, falling back to its container when `<viewId>.focus` is unavailable. */
export async function revealView(viewId: string, viewContainerId: string): Promise<void> {
  const availableCommands = await commands.getCommands(true);

  await commands.executeCommand(pickRevealCommand(viewId, viewContainerId, availableCommands));
}
