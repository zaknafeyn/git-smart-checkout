import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { ConfigurationManager } from '../configuration/configurationManager';
import { LoggingService } from '../logging/loggingService';
import { execCommand } from '../utils/execCommand';

export class WorktreeSetupService {
  constructor(private readonly config: ConfigurationManager, private readonly log: LoggingService) {}

  async runSetup(sourceRoot: string, targetRoot: string): Promise<number> {
    const settings = this.config.get().worktreeSetup;
    let copied = 0;
    if (settings.copyFiles.length > 0) {
      const { stdout } = await execCommand('git', ['ls-files', '--others', '-z'], this.log, { cwd: sourceRoot });
      const ignored = await execCommand('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '-z'], this.log, { cwd: sourceRoot });
      const candidates = new Set(`${stdout}\0${ignored.stdout}`.split('\0').filter(Boolean));
      for (const relative of candidates) {
        if (!settings.copyFiles.some((glob) => this.matches(relative, glob))) continue;
        const source = path.resolve(sourceRoot, relative);
        const target = path.resolve(targetRoot, relative);
        if (!source.startsWith(`${path.resolve(sourceRoot)}${path.sep}`) || fs.lstatSync(source).isSymbolicLink()) continue;
        if (fs.existsSync(target)) continue;
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
        copied += 1;
      }
    }
    if (settings.command.trim()) {
      await this.runCommand(settings.command, targetRoot);
    }
    return copied;
  }

  private matches(file: string, glob: string): boolean {
    const expression = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*');
    return new RegExp(`^${expression}$`).test(file);
  }

  private runCommand(command: string, cwd: string): Promise<void> {
    return new Promise((resolve) => {
      const child = spawn(command, { cwd, shell: true });
      child.stdout.on('data', (data) => this.log.info(`[worktree setup] ${String(data).trim()}`));
      child.stderr.on('data', (data) => this.log.warn(`[worktree setup] ${String(data).trim()}`));
      child.on('error', (error) => { this.log.warn(`Worktree setup failed: ${error}`); resolve(); });
      child.on('close', (code) => { if (code) this.log.warn(`Worktree setup exited with code ${code}`); resolve(); });
    });
  }
}
