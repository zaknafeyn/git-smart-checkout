import * as assert from 'assert';
import * as vscode from 'vscode';

import { ConfigurationManager } from '../../configuration/configurationManager';
import { EXTENSION_NAME } from '../../const';

describe('ConfigurationManager', () => {
  const config = vscode.workspace.getConfiguration(EXTENSION_NAME);

  afterEach(async () => {
    await config.update('jira.username', undefined, vscode.ConfigurationTarget.Global);
    await config.update('jira.email', undefined, vscode.ConfigurationTarget.Global);
  });

  it('uses deprecated jira.email only when jira.username is empty', async () => {
    await config.update('jira.username', '', vscode.ConfigurationTarget.Global);
    await config.update('jira.email', 'legacy@example.com', vscode.ConfigurationTarget.Global);

    const manager = new ConfigurationManager();
    assert.strictEqual(manager.get().jira.username, 'legacy@example.com');

    await config.update('jira.username', 'current@example.com', vscode.ConfigurationTarget.Global);
    manager.reload();

    assert.strictEqual(manager.get().jira.username, 'current@example.com');
  });
});
