import { ConfigurationTarget, workspace } from "vscode";
import { AUTO_STASH_MODE_MANUAL, ExtensionConfig } from "./extensionConfig";
import { EXTENSION_NAME } from "../const";


export class ConfigurationManager {
    private config: ExtensionConfig;
  
  constructor() {
    const vscodeConfig = workspace.getConfiguration(EXTENSION_NAME);
      
    this.config = {
        mode: vscodeConfig.get('mode', AUTO_STASH_MODE_MANUAL),
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
}
