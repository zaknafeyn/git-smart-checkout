import * as vscode from 'vscode';

import { NamedTemplate } from '../../configuration/extensionConfig';

interface TemplateQuickPickItem extends vscode.QuickPickItem {
  entry: NamedTemplate;
}

/**
 * Lets the user choose one named template from a list.
 *
 * - Empty list → returns `undefined` (caller handles the "not configured" case).
 * - Single entry → returns it directly WITHOUT showing any UI, so single-template
 *   setups behave exactly like the legacy single-template flow.
 * - Multiple entries → shows a QuickPick where each item's label is the template
 *   name and its description is a lightweight-resolved preview of the generated
 *   value (via `buildPreviewValue`). `matchOnDescription` lets the user filter by
 *   name or by generated value. Returns the picked entry, or `undefined` if the
 *   user cancels.
 *
 * `buildPreviewValue` must not throw; it should resolve the template with
 * `{ preview: true }` so scripts, the {r} loop, and Jira prompts are skipped.
 */
export async function pickTemplate(
  entries: NamedTemplate[],
  buildPreviewValue: (entry: NamedTemplate) => Promise<string>,
  title: string
): Promise<NamedTemplate | undefined> {
  if (entries.length === 0) {
    return undefined;
  }
  if (entries.length === 1) {
    return entries[0];
  }

  const items: TemplateQuickPickItem[] = await Promise.all(
    entries.map(async (entry) => {
      let description = entry.template;
      try {
        const preview = await buildPreviewValue(entry);
        if (preview) {
          description = preview;
        }
      } catch {
        // Fall back to the raw template string on any resolution failure.
      }
      return { label: entry.name, description, entry };
    })
  );

  const picked = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: 'Select a template (search by name or generated value)',
    ignoreFocusOut: true,
    matchOnDescription: true,
  });

  return picked?.entry;
}
