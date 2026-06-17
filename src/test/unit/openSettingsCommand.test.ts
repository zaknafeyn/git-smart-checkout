import * as assert from 'assert';
import * as vscode from 'vscode';

import { OpenSettingsCommand } from '../../commands/openSettingsCommand';
import { EXTENSION_ID } from '../../const';
import { mockLogService } from '../e2e/helpers/mockLogService';

describe('OpenSettingsCommand', () => {
  it('opens VS Code settings filtered to the extension', async () => {
    const calls: Array<{ command: string; args: unknown[] }> = [];
    const original = vscode.commands.executeCommand.bind(vscode.commands);

    (vscode.commands as any).executeCommand = async (command: string, ...args: unknown[]) => {
      calls.push({ command, args });
      return undefined;
    };

    try {
      const command = new OpenSettingsCommand(mockLogService);
      await command.execute();

      assert.deepStrictEqual(calls, [
        { command: 'workbench.action.openSettings', args: [`@ext:${EXTENSION_ID}`] },
      ]);
    } finally {
      (vscode.commands as any).executeCommand = original;
    }
  });
});
