import { ConfigurationTarget, Disposable, SecretStorage, workspace } from 'vscode';
import { AUTO_STASH_MODE_MANUAL, ExtensionConfig, PreferredRefsMap, PreferredRefsRepo, PULL_AFTER_CHECKOUT_FF_ONLY } from './extensionConfig';
import { EXTENSION_NAME } from '../const';
import { IGitRef } from '../common/git/types';
import { JIRA_TOKEN_SECRET_KEY, migrateJiraTokenSetting } from './jiraTokenStore';
import {
  cleanupMissingRefs,
  getRepoPrefs,
  isRefPreferred,
  sortByPreferredOrder,
  togglePreferredRef,
} from './preferredRefs';

/** globalState key tracking whether the one-time jira.email migration notice has been shown. */
export const JIRA_EMAIL_MIGRATION_NOTICE_SHOWN_KEY = 'jira.emailMigrationNoticeShown';

/**
 * Whether the one-time "please migrate to jira.username" notice should be
 * shown: the user is still relying on the deprecated `jira.email` setting and
 * hasn't already been notified.
 */
export function shouldShowJiraEmailMigrationNotice(
  isUsingDeprecatedJiraEmail: boolean,
  noticeAlreadyShown: boolean
): boolean {
  return isUsingDeprecatedJiraEmail && !noticeAlreadyShown;
}

/** Minimal slice of `vscode.WorkspaceConfiguration` needed to update the stash mode. */
export interface ModeConfig {
  update(section: 'mode', value: ExtensionConfig['mode'], target: ConfigurationTarget): Thenable<void>;
}

export class ConfigurationManager {
  private config: ExtensionConfig;
  /** Jira API token cached from Secret Storage; never read from settings. */
  private jiraToken = '';

  constructor(private readonly secrets: SecretStorage) {
    this.config = this.readConfig();
  }

  /**
   * Migrate any legacy plaintext token into Secret Storage, load the stored
   * token into the in-memory config, and keep it in sync with external changes.
   * Call once during activation.
   *
   * @param onChange invoked after the cached token is refreshed from an
   *   external secret change (e.g. another window), so dependent UI such as
   *   command visibility can re-evaluate.
   * @returns a disposable for the secret-change subscription.
   */
  public async initJiraToken(onChange?: () => void): Promise<Disposable> {
    await migrateJiraTokenSetting(this.secrets);
    await this.refreshJiraToken();

    return this.secrets.onDidChange(async (event) => {
      if (event.key === JIRA_TOKEN_SECRET_KEY) {
        await this.refreshJiraToken();
        onChange?.();
      }
    });
  }

  /** Store (or, when empty, remove) the Jira API token in Secret Storage. */
  public async setJiraToken(token: string): Promise<void> {
    const trimmed = token.trim();
    if (trimmed === '') {
      await this.secrets.delete(JIRA_TOKEN_SECRET_KEY);
    } else {
      await this.secrets.store(JIRA_TOKEN_SECRET_KEY, trimmed);
    }
    // Refresh eagerly so callers see the new value immediately; the onDidChange
    // listener will also fire and is idempotent.
    await this.refreshJiraToken();
  }

  /** Whether a non-empty Jira API token is currently stored. */
  public hasJiraToken(): boolean {
    return this.jiraToken.trim() !== '';
  }

  private async refreshJiraToken(): Promise<void> {
    this.jiraToken = (await this.secrets.get(JIRA_TOKEN_SECRET_KEY)) ?? '';
    this.config = this.readConfig();
  }

  public reload() {
    this.config = this.readConfig();
  }

  private readConfig(): ExtensionConfig {
    const vscodeConfig = workspace.getConfiguration(EXTENSION_NAME);

    return {
      mode: vscodeConfig.get('mode', AUTO_STASH_MODE_MANUAL),
      useFastBranchList: vscodeConfig.get('useFastBranchList', true),
      recentBranchCount: vscodeConfig.get('recentBranchCount', 5),
      showStatusBar: vscodeConfig.get('showStatusBar', true),
      defaultTargetBranch: vscodeConfig.get('defaultTargetBranch', 'main'),
      defaultWorktreeDirectory: vscodeConfig.get('defaultWorktreeDirectory', ''),
      worktreeSetup: {
        copyFiles: vscodeConfig.get('worktreeSetup.copyFiles', [] as string[]),
        command: vscodeConfig.get('worktreeSetup.command', ''),
        applyToPrCloneWorktrees: vscodeConfig.get('worktreeSetup.applyToPrCloneWorktrees', false),
      },
      prBranchPrefix: vscodeConfig.get('prBranchPrefix', ''),
      useInPlaceCherryPick: vscodeConfig.get('useInPlaceCherryPick', true),
      pullAfterCheckout: vscodeConfig.get('pullAfterCheckout', PULL_AFTER_CHECKOUT_FF_ONLY),
      preferredRefs: vscodeConfig.get('preferredRefs', {} as PreferredRefsMap),
      logging: {
        enabled: vscodeConfig.get('logging.enabled', true),
      },
      telemetry: {
        enabled: vscodeConfig.get('telemetry.enabled', true),
      },
      tagTemplate: vscodeConfig.get('tagTemplate', ''),
      pushTagWithoutConfirmation: vscodeConfig.get('pushTagWithoutConfirmation', false),
      tagRemote: vscodeConfig.get('tagRemote', 'origin'),
      branchTemplate: vscodeConfig.get('branchTemplate', ''),
      jira: this.readJiraConfig(vscodeConfig),
    };
  }

  private readJiraConfig(vscodeConfig: ReturnType<typeof workspace.getConfiguration>) {
    const username =
      vscodeConfig.get<string>('jira.username', '') ||
      vscodeConfig.get<string>('jira.email', '');
    return {
      domain: vscodeConfig.get('jira.domain', ''),
      username,
      // The token lives in Secret Storage, not settings. See initJiraToken.
      token: this.jiraToken,
      projectKeys: vscodeConfig.get<string[]>('jira.projectKeys', []),
    };
  }

  /**
   * True when the user still relies on the deprecated `jira.email` setting
   * (i.e. the replacement `jira.username` is unset) — used to decide whether
   * to nudge them toward migrating, once per install.
   */
  public isUsingDeprecatedJiraEmailSetting(): boolean {
    const vscodeConfig = workspace.getConfiguration(EXTENSION_NAME);
    const username = vscodeConfig.get<string>('jira.username', '').trim();
    const email = vscodeConfig.get<string>('jira.email', '').trim();
    return username === '' && email !== '';
  }

  public get(): ExtensionConfig {
    return this.config;
  }

  /**
   * Persist the stash mode. Scoped to the current workspace when one is open,
   * so the mode shadows the global default per-repo (matches the website's
   * "remembers it per workspace" promise); falls back to Global when no
   * workspace is open (e.g. an empty editor window) since there is nothing to
   * scope to.
   *
   * `config` and `hasWorkspace` are overridable for unit testing without a
   * real workspace open.
   */
  public async updateMode(
    mode: ExtensionConfig['mode'],
    config: ModeConfig = workspace.getConfiguration(EXTENSION_NAME),
    hasWorkspace: boolean = Boolean(workspace.workspaceFolders && workspace.workspaceFolders.length > 0)
  ): Promise<void> {
    const target = hasWorkspace ? ConfigurationTarget.Workspace : ConfigurationTarget.Global;
    await config.update('mode', mode, target);
  }

  public async updateLoggingEnabled(enabled: boolean): Promise<void> {
    const config = workspace.getConfiguration(EXTENSION_NAME);
    await config.update('logging.enabled', enabled, ConfigurationTarget.Global);
  }

  public async updateShowStatusBar(enabled: boolean): Promise<void> {
    const config = workspace.getConfiguration(EXTENSION_NAME);
    await config.update('showStatusBar', enabled, ConfigurationTarget.Global);
  }

  /** Persist the Jira Cloud host in settings (empty clears it). */
  public async updateJiraDomain(domain: string): Promise<void> {
    const config = workspace.getConfiguration(EXTENSION_NAME);
    await config.update('jira.domain', domain === '' ? undefined : domain, ConfigurationTarget.Global);
  }

  /** Persist the Jira account username in settings (empty clears it). */
  public async updateJiraUsername(username: string): Promise<void> {
    const config = workspace.getConfiguration(EXTENSION_NAME);
    await config.update('jira.username', username === '' ? undefined : username, ConfigurationTarget.Global);
  }

  // Preferred refs helpers
  public getPreferredRefs(repoId: string): PreferredRefsRepo {
    return getRepoPrefs(this.config.preferredRefs, repoId);
  }

  public isPreferred(repoId: string, ref: IGitRef): boolean {
    return isRefPreferred(this.getPreferredRefs(repoId), ref);
  }

  /** Sort refs by the order they were starred in (non-preferred refs sort last). */
  public sortByPreferredOrder<T extends IGitRef>(repoId: string, refs: T[]): T[] {
    return sortByPreferredOrder(refs, this.getPreferredRefs(repoId));
  }

  public async togglePreferred(repoId: string, ref: IGitRef, existingRefs: IGitRef[]): Promise<void> {
    const config = workspace.getConfiguration(EXTENSION_NAME);
    // fetch the plain stored value rather than the proxied/merged one
    const map = (config.inspect<PreferredRefsMap>('preferredRefs')?.globalValue || {}) as PreferredRefsMap;
    const nextPrefs = togglePreferredRef(getRepoPrefs(map, repoId), ref, existingRefs);

    const updated: PreferredRefsMap = { ...map, [repoId]: nextPrefs };
    await config.update('preferredRefs', updated, ConfigurationTarget.Global);
    this.reload();
  }

  public async cleanupMissing(repoId: string, existingFullRefnames: Set<string>): Promise<void> {
    const map = (this.config.preferredRefs || {}) as PreferredRefsMap;
    const prefs = map[repoId];
    if (!prefs) {
      return;
    }

    const { prefs: newPrefs, changed } = cleanupMissingRefs(prefs, existingFullRefnames);
    if (changed) {
      const config = workspace.getConfiguration(EXTENSION_NAME);
      const updated: PreferredRefsMap = { ...map, [repoId]: newPrefs };
      await config.update('preferredRefs', updated, ConfigurationTarget.Global);
      this.reload();
    }
  }
}
