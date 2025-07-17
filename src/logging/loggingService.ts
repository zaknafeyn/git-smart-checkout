import { Disposable, OutputChannel, window } from "vscode";
import { ConfigurationManager } from "../configuration/configurationManager";
import { EXTENSION_NAME } from "../const";

export class LoggingService implements Disposable {
  private outputChannel: OutputChannel;
  private configManager: ConfigurationManager;
  
  constructor(configManager: ConfigurationManager) {
      this.configManager = configManager;
      this.outputChannel = window.createOutputChannel(EXTENSION_NAME);
  } 
  
  
  private log(level: string, message: string, data?: any): void {
    const config = this.configManager.get();

    if (!config.logging.enabled) {
      return;
    }
      
    const timestamp = new Date().toISOString();
    
    const formattedMessage = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    this.outputChannel.appendLine(formattedMessage);
    if (data) {
        this.outputChannel.appendLine(`Data: ${JSON.stringify(data, null, 2)}`);
    }

    if (data) {
      console.log(formattedMessage);
    } else {
      console.log(formattedMessage, `Data: ${JSON.stringify(data, null, 2)}`);
    }
  }
  
  public error(message: string, data?: any): void {
      this.log('error', message, data);
  }
  
  public warn(message: string, data?: any): void {
      this.log('warn', message, data);
  }
  
  public info(message: string, data?: any): void {
      this.log('info', message, data);
  }
  
  public debug(message: string, data?: any): void {
      this.log('debug', message, data);
  }
  
  public dispose(): void {
      this.outputChannel.dispose();
  }
}
