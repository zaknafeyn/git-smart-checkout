import * as assert from 'assert';
import { ConfigurationTarget } from 'vscode';

import {
  JIRA_TOKEN_SECRET_KEY,
  LegacyTokenConfig,
  migrateJiraTokenSetting,
} from '../../configuration/jiraTokenStore';
import { FakeSecretStorage } from './helpers/fakeSecretStorage';

interface InspectResult {
  globalValue?: string;
  workspaceValue?: string;
  workspaceFolderValue?: string;
}

/** Fake `vscode.WorkspaceConfiguration` slice that records `update` calls. */
class FakeLegacyConfig implements LegacyTokenConfig {
  readonly cleared: ConfigurationTarget[] = [];

  constructor(private readonly inspectResult: InspectResult | undefined) {}

  inspect<T>(_section: string) {
    return this.inspectResult as
      | { globalValue?: T; workspaceValue?: T; workspaceFolderValue?: T }
      | undefined;
  }

  async update(_section: string, value: undefined, target: ConfigurationTarget): Promise<void> {
    assert.strictEqual(value, undefined, 'migration must only clear the setting');
    this.cleared.push(target);
  }
}

describe('migrateJiraTokenSetting', () => {
  it('is a no-op when the setting was never declared', async () => {
    const secrets = new FakeSecretStorage();
    const config = new FakeLegacyConfig(undefined);

    const migrated = await migrateJiraTokenSetting(secrets, config);

    assert.strictEqual(migrated, false);
    assert.strictEqual(await secrets.get(JIRA_TOKEN_SECRET_KEY), undefined);
    assert.deepStrictEqual(config.cleared, []);
  });

  it('does nothing when no scope holds a value', async () => {
    const secrets = new FakeSecretStorage();
    const config = new FakeLegacyConfig({});

    const migrated = await migrateJiraTokenSetting(secrets, config);

    assert.strictEqual(migrated, false);
    assert.strictEqual(await secrets.get(JIRA_TOKEN_SECRET_KEY), undefined);
    assert.deepStrictEqual(config.cleared, []);
  });

  it('moves a global plaintext token into Secret Storage and clears the setting', async () => {
    const secrets = new FakeSecretStorage();
    const config = new FakeLegacyConfig({ globalValue: 'super-secret' });

    const migrated = await migrateJiraTokenSetting(secrets, config);

    assert.strictEqual(migrated, true);
    assert.strictEqual(await secrets.get(JIRA_TOKEN_SECRET_KEY), 'super-secret');
    assert.deepStrictEqual(config.cleared, [ConfigurationTarget.Global]);
  });

  it('trims whitespace around the migrated value', async () => {
    const secrets = new FakeSecretStorage();
    const config = new FakeLegacyConfig({ globalValue: '  padded-token  ' });

    await migrateJiraTokenSetting(secrets, config);

    assert.strictEqual(await secrets.get(JIRA_TOKEN_SECRET_KEY), 'padded-token');
  });

  it('clears the workspace scope when the value lives there', async () => {
    const secrets = new FakeSecretStorage();
    const config = new FakeLegacyConfig({ workspaceValue: 'ws-token' });

    const migrated = await migrateJiraTokenSetting(secrets, config);

    assert.strictEqual(migrated, true);
    assert.strictEqual(await secrets.get(JIRA_TOKEN_SECRET_KEY), 'ws-token');
    assert.deepStrictEqual(config.cleared, [ConfigurationTarget.Workspace]);
  });

  it('clears every scope that defines the setting', async () => {
    const secrets = new FakeSecretStorage();
    const config = new FakeLegacyConfig({
      globalValue: 'g',
      workspaceValue: 'w',
      workspaceFolderValue: 'wf',
    });

    await migrateJiraTokenSetting(secrets, config);

    assert.deepStrictEqual(config.cleared, [
      ConfigurationTarget.Global,
      ConfigurationTarget.Workspace,
      ConfigurationTarget.WorkspaceFolder,
    ]);
    // Global value wins as the seed.
    assert.strictEqual(await secrets.get(JIRA_TOKEN_SECRET_KEY), 'g');
  });

  it('never overwrites a token already stored in Secret Storage', async () => {
    const secrets = new FakeSecretStorage();
    secrets.seed(JIRA_TOKEN_SECRET_KEY, 'existing-secret');
    const config = new FakeLegacyConfig({ globalValue: 'stale-plaintext' });

    const migrated = await migrateJiraTokenSetting(secrets, config);

    assert.strictEqual(migrated, true);
    assert.strictEqual(await secrets.get(JIRA_TOKEN_SECRET_KEY), 'existing-secret');
    // The stray plaintext is still cleared from settings.
    assert.deepStrictEqual(config.cleared, [ConfigurationTarget.Global]);
  });

  it('clears an empty plaintext value without storing a secret', async () => {
    const secrets = new FakeSecretStorage();
    const config = new FakeLegacyConfig({ globalValue: '   ' });

    const migrated = await migrateJiraTokenSetting(secrets, config);

    assert.strictEqual(migrated, false);
    assert.strictEqual(await secrets.get(JIRA_TOKEN_SECRET_KEY), undefined);
    assert.deepStrictEqual(config.cleared, [ConfigurationTarget.Global]);
  });
});
