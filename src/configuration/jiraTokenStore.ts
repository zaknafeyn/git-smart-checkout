import { ConfigurationTarget, workspace } from 'vscode';
import { EXTENSION_NAME } from '../const';

/**
 * Key under which the Jira API token is stored in VS Code Secret Storage
 * (`context.secrets`). Namespaced to avoid clashing with other extensions.
 */
export const JIRA_TOKEN_SECRET_KEY = 'git-smart-checkout.jira.token';

/** Settings section (relative to {@link EXTENSION_NAME}) of the legacy plaintext token. */
const LEGACY_TOKEN_SETTING = 'jira.token';

/** Minimal slice of `vscode.SecretStorage` needed for migration. */
export interface JiraSecretWriter {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
}

/** Minimal slice of `vscode.WorkspaceConfiguration` needed for migration. */
export interface LegacyTokenConfig {
  inspect<T>(section: string):
    | { globalValue?: T; workspaceValue?: T; workspaceFolderValue?: T }
    | undefined;
  update(section: string, value: undefined, target: ConfigurationTarget): Thenable<void>;
}

/**
 * One-time migration of a plaintext `git-smart-checkout.jira.token` setting into
 * Secret Storage. The legacy value is stored as a secret (unless a secret is
 * already present, which always wins) and the plaintext setting is cleared from
 * every scope that defines it so it is no longer persisted or synced.
 *
 * Safe to call on every activation: when the setting is absent it is a no-op.
 *
 * @returns `true` when a non-empty legacy value was found and migrated.
 */
export async function migrateJiraTokenSetting(
  secrets: JiraSecretWriter,
  config: LegacyTokenConfig = workspace.getConfiguration(EXTENSION_NAME)
): Promise<boolean> {
  const inspected = config.inspect<string>(LEGACY_TOKEN_SETTING);
  if (!inspected) {
    return false;
  }

  const candidate =
    inspected.globalValue ?? inspected.workspaceValue ?? inspected.workspaceFolderValue;
  const legacyValue = typeof candidate === 'string' ? candidate.trim() : '';

  let migrated = false;
  if (legacyValue !== '') {
    // A secret set explicitly via the command always wins; only seed the secret
    // from the legacy setting when no secret exists yet.
    const existing = await secrets.get(JIRA_TOKEN_SECRET_KEY);
    if (!existing) {
      await secrets.store(JIRA_TOKEN_SECRET_KEY, legacyValue);
    }
    migrated = true;
  }

  // Clear the plaintext setting wherever it is defined so it stops being
  // persisted (and synced via Settings Sync).
  await clearScope(config, inspected.globalValue, ConfigurationTarget.Global);
  await clearScope(config, inspected.workspaceValue, ConfigurationTarget.Workspace);
  await clearScope(config, inspected.workspaceFolderValue, ConfigurationTarget.WorkspaceFolder);

  return migrated;
}

async function clearScope(
  config: LegacyTokenConfig,
  value: string | undefined,
  target: ConfigurationTarget
): Promise<void> {
  if (value === undefined) {
    return;
  }
  await config.update(LEGACY_TOKEN_SETTING, undefined, target);
}
