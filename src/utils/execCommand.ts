import { exec, ExecSyncOptions, ExecSyncOptionsWithStringEncoding } from "child_process";
import { promisify } from "util";
import { createPromiseWithResolvers } from "./createPromiseWithResolvers";

const execAsync = promisify(exec);

export type TPromiseResponse = { stdout: string, stderr: string }

export async function  execCommand (command: string, options?: ExecSyncOptions, verbose = false, logger: (args: unknown) => void = console.log): Promise<TPromiseResponse> {
    const { promise, resolve, reject } = createPromiseWithResolvers<TPromiseResponse>();

    try {
      const { stdout, stderr } = await execAsync(command, { encoding: 'utf-8', ...options });

      if ( verbose && logger) {
        logger({ stdout, stderr });
      }

      resolve({ stdout, stderr });
    } catch (err) {
      reject(err);
    }

    return promise;
  }
