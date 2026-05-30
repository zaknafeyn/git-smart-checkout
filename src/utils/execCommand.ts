import { execFile, ExecFileOptions } from 'child_process';

import { LoggingService } from '../logging/loggingService';

export type TPromiseResponse = { stdout: string; stderr: string };

export async function execCommand(
  file: string,
  args: string[],
  logService: LoggingService,
  options?: ExecFileOptions
): Promise<TPromiseResponse> {
  const commandStr = [file, ...args].join(' ');
  const combinedOptions = { encoding: 'utf-8' as const, ...options };

  return new Promise((resolve, reject) => {
    execFile(file, args, combinedOptions, (err, stdout, stderr) => {
      const stdoutStr = String(stdout ?? '');
      const stderrStr = String(stderr ?? '');

      if (err) {
        // Attach stdout/stderr to the error so callers can inspect partial output
        // (e.g. cherryPick reads exit code+stderr, getStashConflictPreview reads stdout).
        (err as any).stdout = stdoutStr;
        (err as any).stderr = stderrStr;
        logService.error(commandStr, err);
        reject(err);
      } else {
        logService.info(commandStr, { stdout: stdoutStr, stderr: stderrStr });
        resolve({ stdout: stdoutStr, stderr: stderrStr });
      }
    });
  });
}
