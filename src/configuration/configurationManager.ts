import { ConfigurationTarget, workspace } from 'vscode';
import { AUTO_STASH_MODE_MANUAL, ExtensionConfig } from './extensionConfig';
import { EXTENSION_NAME } from '../const';

export class ConfigurationManager {
  private config: ExtensionConfig;

  constructor() {
    const vscodeConfig = workspace.getConfiguration(EXTENSION_NAME);

    this.config = {
      mode: vscodeConfig.get('mode', AUTO_STASH_MODE_MANUAL),
      refetchBeforeCheckout: vscodeConfig.get('refetchBeforeCheckout', false),
      showStatusBar: vscodeConfig.get('showStatusBar', true),
      defaultTargetBranch: vscodeConfig.get('defaultTargetBranch', 'main'),
      useInPlaceCherryPick: vscodeConfig.get('useInPlaceCherryPick', true),
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
      showStatusBar: vscodeConfig.get('showStatusBar', true),
      defaultTargetBranch: vscodeConfig.get('defaultTargetBranch', 'main'),
      useInPlaceCherryPick: vscodeConfig.get('useInPlaceCherryPick', true),
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
}
