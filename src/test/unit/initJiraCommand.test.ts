import * as assert from 'assert';
import * as vscode from 'vscode';

import { InitJiraCommand } from '../../commands/initJiraCommand';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { JIRA_TOKEN_SECRET_KEY } from '../../configuration/jiraTokenStore';
import { EXTENSION_NAME } from '../../const';
import { FakeSecretStorage } from './helpers/fakeSecretStorage';
import { mockLogService } from '../e2e/helpers/mockLogService';

/** InitJiraCommand with scripted input-box responses and captured prompts. */
class ScriptedInitJiraCommand extends InitJiraCommand {
  readonly seenInputBoxes: vscode.InputBoxOptions[] = [];
  readonly infoMessages: string[] = [];
  readonly errorMessages: string[] = [];

  constructor(
    configManager: ConfigurationManager,
    private readonly responses: Array<string | undefined>
  ) {
    super(configManager, mockLogService);
  }

  protected async showInputBox(options: vscode.InputBoxOptions): Promise<string | undefined> {
    this.seenInputBoxes.push(options);
    return this.responses.shift();
  }

  protected async showInformationMessage(message: string, ..._items: string[]): Promise<string | undefined> {
    this.infoMessages.push(message);
    return undefined;
  }

  protected async showErrorMessage(message: string, ..._items: string[]): Promise<string | undefined> {
    this.errorMessages.push(message);
    return undefined;
  }
}

describe('InitJiraCommand', () => {
  const config = vscode.workspace.getConfiguration(EXTENSION_NAME);

  afterEach(async () => {
    await config.update('jira.domain', undefined, vscode.ConfigurationTarget.Global);
    await config.update('jira.username', undefined, vscode.ConfigurationTarget.Global);
    await config.update('jira.email', undefined, vscode.ConfigurationTarget.Global);
    await config.update('jira.token', undefined, vscode.ConfigurationTarget.Global);
  });

  it('stores domain/username in settings and the token in Secret Storage', async () => {
    const secrets = new FakeSecretStorage();
    const manager = new ConfigurationManager(secrets);
    const command = new ScriptedInitJiraCommand(manager, [
      'team.atlassian.net',
      'me@example.com',
      'api-token-123',
    ]);

    await command.execute();

    assert.strictEqual(manager.get().jira.domain, 'team.atlassian.net');
    assert.strictEqual(manager.get().jira.username, 'me@example.com');
    assert.strictEqual(manager.get().jira.token, 'api-token-123');
    assert.strictEqual(await secrets.get(JIRA_TOKEN_SECRET_KEY), 'api-token-123');
    assert.deepStrictEqual(command.infoMessages, ['Jira credentials saved.']);
  });

  it('prefills existing values and renders the token masked', async () => {
    const secrets = new FakeSecretStorage();
    const manager = new ConfigurationManager(secrets);

    await manager.setJiraToken('existing-token');
    await config.update('jira.domain', 'old.atlassian.net', vscode.ConfigurationTarget.Global);
    await config.update('jira.username', 'old@example.com', vscode.ConfigurationTarget.Global);
    manager.reload();

    const command = new ScriptedInitJiraCommand(manager, [
      'old.atlassian.net',
      'old@example.com',
      'existing-token',
    ]);

    await command.execute();

    const [domainBox, usernameBox, tokenBox] = command.seenInputBoxes;
    assert.strictEqual(domainBox.value, 'old.atlassian.net');
    assert.strictEqual(usernameBox.value, 'old@example.com');
    assert.strictEqual(tokenBox.value, 'existing-token');
    assert.strictEqual(tokenBox.password, true);
  });

  it('trims values and removes the token when the token step is cleared', async () => {
    const secrets = new FakeSecretStorage();
    const manager = new ConfigurationManager(secrets);
    await manager.setJiraToken('to-remove');

    const command = new ScriptedInitJiraCommand(manager, [
      '  spaced.atlassian.net  ',
      '  user@example.com  ',
      '   ',
    ]);

    await command.execute();

    assert.strictEqual(manager.get().jira.domain, 'spaced.atlassian.net');
    assert.strictEqual(manager.get().jira.username, 'user@example.com');
    assert.strictEqual(manager.get().jira.token, '');
    assert.strictEqual(await secrets.get(JIRA_TOKEN_SECRET_KEY), undefined);
  });

  it('persists nothing when cancelled at the first step', async () => {
    const secrets = new FakeSecretStorage();
    const manager = new ConfigurationManager(secrets);
    const command = new ScriptedInitJiraCommand(manager, [undefined]);

    await command.execute();

    assert.strictEqual(command.seenInputBoxes.length, 1);
    assert.strictEqual(await secrets.get(JIRA_TOKEN_SECRET_KEY), undefined);
    assert.deepStrictEqual(command.infoMessages, []);
  });

  it('persists nothing when cancelled at the token step', async () => {
    const secrets = new FakeSecretStorage();
    const manager = new ConfigurationManager(secrets);
    const command = new ScriptedInitJiraCommand(manager, [
      'team.atlassian.net',
      'me@example.com',
      undefined,
    ]);

    await command.execute();

    assert.strictEqual(command.seenInputBoxes.length, 3);
    assert.strictEqual(await secrets.get(JIRA_TOKEN_SECRET_KEY), undefined);
    assert.deepStrictEqual(command.infoMessages, []);
  });
});
