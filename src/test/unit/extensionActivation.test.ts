import * as assert from 'assert';
import * as vscode from 'vscode';

import { EXTENSION_NAME } from '../../const';

interface ExtensionApi {
  commandManager: {
    getCommand(commandId: string): unknown;
  };
}

describe('extension activation API', () => {
  it('exposes the command manager without persisting it in global state', async () => {
    const extension = vscode.extensions.all.find(
      (candidate) => candidate.packageJSON?.name === EXTENSION_NAME
    );
    assert.ok(extension);

    const api = await extension.activate() as ExtensionApi;

    assert.ok(api.commandManager);
    assert.ok(api.commandManager.getCommand(`${EXTENSION_NAME}.checkoutTo`));
  });
});
