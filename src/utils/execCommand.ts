import { exec, ExecSyncOptions, ExecSyncOptionsWithStringEncoding } from 'child_process';
import { promisify } from 'util';
import { createPromiseWithResolvers } from './createPromiseWithResolvers';
import { LoggingService } from '../logging/loggingService';

const execAsync = promisify(exec);

export type TPromiseResponse = { stdout: string; stderr: string };

export async function execCommand(
  command: string,
  logService: LoggingService,
  options?: ExecSyncOptions,
): Promise<TPromiseResponse> {
  const { promise, resolve, reject } = createPromiseWithResolvers<TPromiseResponse>();

  try {
    const { stdout, stderr } = await execAsync(command, { encoding: 'utf-8', ...options });

    logService.info(command, { stdout, stderr });

    resolve({ stdout, stderr });
  } catch (err) {
    reject(err);
  }

  return promise;
}
