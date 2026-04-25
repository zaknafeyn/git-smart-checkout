import { ConfigurationTarget, workspace } from 'vscode';
import { AUTO_STASH_MODE_MANUAL, ExtensionConfig, PreferredRefsMap, PreferredRefsRepo } from './extensionConfig';
import { EXTENSION_NAME } from '../const';
import { IGitRef } from '../common/git/types';

export class ConfigurationManager {
  private config: ExtensionConfig;

  constructor() {
    const vscodeConfig = workspace.getConfiguration(EXTENSION_NAME);

    this.config = {
      mode: vscodeConfig.get('mode', AUTO_STASH_MODE_MANUAL),
      refetchBeforeCheckout: vscodeConfig.get('refetchBeforeCheckout', false),
      useFastBranchList: vscodeConfig.get('useFastBranchList', true),
      showStatusBar: vscodeConfig.get('showStatusBar', true),
      defaultTargetBranch: vscodeConfig.get('defaultTargetBranch', 'main'),
      prBranchPrefix: vscodeConfig.get('prBranchPrefix', ''),
      useInPlaceCherryPick: vscodeConfig.get('useInPlaceCherryPick', true),
      preferredRefs: vscodeConfig.get('preferredRefs', {} as PreferredRefsMap),
      logging: {
        enabled: vscodeConfig.get('logging.enabled', true),
      },
    };
  }

  public reload() {
    const vscodeConfig = workspace.getConfiguration(EXTENSION_NAME);

    this.config = {
      mode: vscodeConfig.get('mode', AUTO_STASH_MODE_MANUAL),
      refetchBeforeCheckout: vscodeConfig.get('refetchBeforeCheckout', false),
      useFastBranchList: vscodeConfig.get('useFastBranchList', true),
      showStatusBar: vscodeConfig.get('showStatusBar', true),
      defaultTargetBranch: vscodeConfig.get('defaultTargetBranch', 'main'),
      prBranchPrefix: vscodeConfig.get('prBranchPrefix', ''),
      useInPlaceCherryPick: vscodeConfig.get('useInPlaceCherryPick', true),
      preferredRefs: vscodeConfig.get('preferredRefs', {} as PreferredRefsMap),
      logging: {
        enabled: vscodeConfig.get('logging.enabled', true),
      },
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

  public async updateRefetchBeforeCheckoutEnabled(enabled: boolean): Promise<void> {
    const config = workspace.getConfiguration(EXTENSION_NAME);
    await config.update('refetchBeforeCheckout', enabled, ConfigurationTarget.Global);
  }

  public async updateShowStatusBar(enabled: boolean): Promise<void> {
    const config = workspace.getConfiguration(EXTENSION_NAME);
    await config.update('showStatusBar', enabled, ConfigurationTarget.Global);
  }

  // Preferred refs helpers
  public getPreferredRefs(repoId: string): PreferredRefsRepo {
    const map = this.config.preferredRefs || {};
    const existing = map[repoId];
    if (existing) {
      return existing;
    }
    return { locals: [], remotes: [], tags: [] };
  }

  public isPreferred(repoId: string, ref: IGitRef): boolean {
    const pref = this.getPreferredRefs(repoId);
    const fullRef = this.getFullRefname(ref);
    if (ref.isTag) {
      return pref.tags.includes(fullRef);
    }
    if (ref.remote) {
      return pref.remotes.includes(fullRef);
    }
    return pref.locals.includes(fullRef);
  }

  public async togglePreferred(repoId: string, ref: IGitRef, existingRefs: IGitRef[]): Promise<void> {
    const config = workspace.getConfiguration(EXTENSION_NAME);
    // fetch plain configuration object rather than proxied one
    const map = (config.inspect<PreferredRefsMap>('preferredRefs')?.globalValue || {}) as PreferredRefsMap;
    const repoPrefs: PreferredRefsRepo = map[repoId] || { locals: [], remotes: [], tags: [] };

    const add = (arr: string[], val: string) => {
      if (!arr.includes(val)) {
        arr.push(val);
      }
    };
    
    const remove = (arr: string[], val: string) => {
      const idx = arr.indexOf(val);
      if (idx >= 0) {arr.splice(idx, 1);}
    };

    if (ref.isTag) {
      const full = this.getFullRefname(ref);
      if (repoPrefs.tags.includes(full)) {
        remove(repoPrefs.tags, full);
      } else {
        add(repoPrefs.tags, full);
      }
    } else if (ref.remote) {
      // toggle remote
      const remoteFull = this.getFullRefname(ref);
      const localFull = `refs/heads/${ref.name}`;
      const existsLocal = existingRefs.some(r => !r.remote && !r.isTag && r.name === ref.name);
      if (repoPrefs.remotes.includes(remoteFull)) {
        remove(repoPrefs.remotes, remoteFull);
        if (existsLocal) {remove(repoPrefs.locals, localFull);}
      } else {
        add(repoPrefs.remotes, remoteFull);
        if (existsLocal) {add(repoPrefs.locals, localFull);}
      }
    } else {
      // toggle local
      const localFull = this.getFullRefname(ref);
      const remoteFulls = existingRefs
        .filter(r => r.remote && !r.isTag && r.name === ref.name)
        .map(r => `refs/remotes/${r.remote}/${r.name}`);
      const isPreferredLocal = repoPrefs.locals.includes(localFull);
      if (isPreferredLocal) {
        remove(repoPrefs.locals, localFull);
        remoteFulls.forEach(rf => remove(repoPrefs.remotes, rf));
      } else {
        add(repoPrefs.locals, localFull);
        remoteFulls.forEach(rf => add(repoPrefs.remotes, rf));
      }
    }

    const updated: PreferredRefsMap = { ...(this.config.preferredRefs || {}), [repoId]: repoPrefs };
    await config.update('preferredRefs', updated, ConfigurationTarget.Global);
    this.reload();
  }

  public async cleanupMissing(repoId: string, existingFullRefnames: Set<string>): Promise<void> {
    const map = (this.config.preferredRefs || {}) as PreferredRefsMap;
    const prefs = map[repoId];
    if (!prefs) {return;}

    const filterExisting = (arr: string[]) => arr.filter(full => existingFullRefnames.has(full));
    const newPrefs: PreferredRefsRepo = {
      locals: filterExisting(prefs.locals),
      remotes: filterExisting(prefs.remotes),
      tags: filterExisting(prefs.tags),
    };

    const changed =
      newPrefs.locals.length !== prefs.locals.length ||
      newPrefs.remotes.length !== prefs.remotes.length ||
      newPrefs.tags.length !== prefs.tags.length;

    if (changed) {
      const config = workspace.getConfiguration(EXTENSION_NAME);
      const updated: PreferredRefsMap = { ...map, [repoId]: newPrefs };
      await config.update('preferredRefs', updated, ConfigurationTarget.Global);
      this.reload();
    }
  }

  private getFullRefname(ref: IGitRef): string {
    if (ref.isTag) {return `refs/tags/${ref.name}`;}
    if (ref.remote) {return `refs/remotes/${ref.remote}/${ref.name}`;}
    return `refs/heads/${ref.name}`;
  }
}
