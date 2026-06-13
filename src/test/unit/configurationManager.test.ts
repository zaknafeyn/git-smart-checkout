import * as assert from 'assert';
import * as vscode from 'vscode';

import { ConfigurationManager } from '../../configuration/configurationManager';
import { EXTENSION_NAME } from '../../const';
import { JIRA_TOKEN_SECRET_KEY } from '../../configuration/jiraTokenStore';
import { FakeSecretStorage } from './helpers/fakeSecretStorage';

describe('ConfigurationManager', () => {
  const config = vscode.workspace.getConfiguration(EXTENSION_NAME);

  afterEach(async () => {
    await config.update('jira.username', undefined, vscode.ConfigurationTarget.Global);
    await config.update('jira.email', undefined, vscode.ConfigurationTarget.Global);
    await config.update('jira.token', undefined, vscode.ConfigurationTarget.Global);
  });

  it('uses deprecated jira.email only when jira.username is empty', async () => {
    await config.update('jira.username', '', vscode.ConfigurationTarget.Global);
    await config.update('jira.email', 'legacy@example.com', vscode.ConfigurationTarget.Global);

    const manager = new ConfigurationManager(new FakeSecretStorage());
    assert.strictEqual(manager.get().jira.username, 'legacy@example.com');

    await config.update('jira.username', 'current@example.com', vscode.ConfigurationTarget.Global);
    manager.reload();

    assert.strictEqual(manager.get().jira.username, 'current@example.com');
  });

  describe('Jira token in Secret Storage', () => {
    it('starts empty and reports no token', () => {
      const manager = new ConfigurationManager(new FakeSecretStorage());
      assert.strictEqual(manager.get().jira.token, '');
      assert.strictEqual(manager.hasJiraToken(), false);
    });

    it('stores a token and exposes it through config', async () => {
      const secrets = new FakeSecretStorage();
      const manager = new ConfigurationManager(secrets);

      await manager.setJiraToken('my-token');

      assert.strictEqual(manager.get().jira.token, 'my-token');
      assert.strictEqual(manager.hasJiraToken(), true);
      assert.strictEqual(await secrets.get(JIRA_TOKEN_SECRET_KEY), 'my-token');
    });

    it('trims the token before storing', async () => {
      const manager = new ConfigurationManager(new FakeSecretStorage());

      await manager.setJiraToken('  spaced-token  ');

      assert.strictEqual(manager.get().jira.token, 'spaced-token');
    });

    it('removes the token when set to an empty value', async () => {
      const secrets = new FakeSecretStorage();
      const manager = new ConfigurationManager(secrets);

      await manager.setJiraToken('to-remove');
      await manager.setJiraToken('   ');

      assert.strictEqual(manager.get().jira.token, '');
      assert.strictEqual(manager.hasJiraToken(), false);
      assert.strictEqual(await secrets.get(JIRA_TOKEN_SECRET_KEY), undefined);
    });

    it('loads an existing secret and tracks external changes via initJiraToken', async () => {
      const secrets = new FakeSecretStorage();
      secrets.seed(JIRA_TOKEN_SECRET_KEY, 'preexisting');
      const manager = new ConfigurationManager(secrets);

      let changeCount = 0;
      const subscription = await manager.initJiraToken(() => {
        changeCount += 1;
      });

      assert.strictEqual(manager.get().jira.token, 'preexisting');

      // Simulate a change from another window writing directly to the store.
      await secrets.store(JIRA_TOKEN_SECRET_KEY, 'updated-elsewhere');
      // The onDidChange handler refreshes asynchronously; let it settle.
      await new Promise((resolve) => setTimeout(resolve, 0));

      assert.strictEqual(manager.get().jira.token, 'updated-elsewhere');
      assert.ok(changeCount >= 1, 'onChange callback should fire on external changes');

      subscription.dispose();
    });
  });
});
