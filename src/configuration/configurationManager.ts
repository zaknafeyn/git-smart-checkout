import { ConfigurationTarget, workspace } from 'vscode';
import { AUTO_STASH_MODE_MANUAL, ExtensionConfig, PreferredRefsMap, PreferredRefsRepo } from './extensionConfig';
import { EXTENSION_NAME } from '../const';
import { IGitRef } from '../common/git/types';
import {
  cleanupMissingRefs,
  getRepoPrefs,
  isRefPreferred,
  sortByPreferredOrder,
  togglePreferredRef,
} from './preferredRefs';

export class ConfigurationManager {
  private config: ExtensionConfig;

  constructor() {
    const vscodeConfig = workspace.getConfiguration(EXTENSION_NAME);

    this.config = {
      mode: vscodeConfig.get('mode', AUTO_STASH_MODE_MANUAL),
      useFastBranchList: vscodeConfig.get('useFastBranchList', true),
      showStatusBar: vscodeConfig.get('showStatusBar', true),
      defaultTargetBranch: vscodeConfig.get('defaultTargetBranch', 'main'),
      defaultWorktreeDirectory: vscodeConfig.get('defaultWorktreeDirectory', ''),
      prBranchPrefix: vscodeConfig.get('prBranchPrefix', ''),
      useInPlaceCherryPick: vscodeConfig.get('useInPlaceCherryPick', true),
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

  public reload() {
    const vscodeConfig = workspace.getConfiguration(EXTENSION_NAME);

    this.config = {
      mode: vscodeConfig.get('mode', AUTO_STASH_MODE_MANUAL),
      useFastBranchList: vscodeConfig.get('useFastBranchList', true),
      showStatusBar: vscodeConfig.get('showStatusBar', true),
      defaultTargetBranch: vscodeConfig.get('defaultTargetBranch', 'main'),
      defaultWorktreeDirectory: vscodeConfig.get('defaultWorktreeDirectory', ''),
      prBranchPrefix: vscodeConfig.get('prBranchPrefix', ''),
      useInPlaceCherryPick: vscodeConfig.get('useInPlaceCherryPick', true),
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
      token: vscodeConfig.get('jira.token', ''),
      projectKeys: vscodeConfig.get<string[]>('jira.projectKeys', []),
    };
  }

  public get(): ExtensionConfig {
    return this.config;
  }

  public async updateMode(mode: ExtensionConfig['mode']): Promise<void> {
    const config = workspace.getConfiguration(EXTENSION_NAME);
    await config.update('mode', mode, ConfigurationTarget.Global);
  }

  public async updateLoggingEnabled(enabled: boolean): Promise<void> {
    const config = workspace.getConfiguration(EXTENSION_NAME);
    await config.update('logging.enabled', enabled, ConfigurationTarget.Global);
  }

  public async updateShowStatusBar(enabled: boolean): Promise<void> {
    const config = workspace.getConfiguration(EXTENSION_NAME);
    await config.update('showStatusBar', enabled, ConfigurationTarget.Global);
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
