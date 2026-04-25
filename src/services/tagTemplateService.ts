import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface TagTemplateLogger {
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  debug(msg: string, data?: unknown): void;
}

export interface ScriptRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface TagTemplateContext {
  workspaceRoot: string;
  /** Resolves current branch name. Return '' for detached HEAD. */
  getCurrentBranch: () => Promise<string>;
  /** Returns true if the tag already exists locally. */
  tagExists: (tagName: string) => Promise<boolean>;
  /** Reads a file as utf8. Defaults to fs.readFile. Override for tests. */
  readFile?: (absPath: string) => Promise<string>;
  /** Resolves realpath of a file. Defaults to fs.realpath. Override for tests. */
  realpath?: (absPath: string) => Promise<string>;
  /**
   * Runs a script at the given absolute path and returns its output.
   * Defaults to spawning the script directly (shell: false). Override for tests.
   */
  runScript?: (absScriptPath: string, cwd: string) => Promise<ScriptRunResult>;
  logger: TagTemplateLogger;
}

export interface ResolvedTag {
  tag: string;
  recurringValueUsed?: number;
  recurringAttempts: number;
}

export class ScriptTokenError extends Error {
  constructor(
    message: string,
    public readonly scriptPath: string,
    public readonly exitCode?: number,
    public readonly stderr?: string
  ) {
    super(message);
    this.name = 'ScriptTokenError';
  }
}

const MAX_RECURRING_ITERATIONS = 10000;

// ─── Token scanner ────────────────────────────────────────────────────────────
// Uses brace-depth counting so regexes like \d{3,4} inside {b:...} work correctly.

interface TokenMatch {
  full: string;
  type: 'f' | 'b' | 'r' | 's';
  args: string;
  index: number;
}

function scanTokens(template: string): TokenMatch[] {
  const tokens: TokenMatch[] = [];
  let i = 0;
  while (i < template.length) {
    if (
      template[i] === '{' &&
      (template[i + 1] === 'f' ||
        template[i + 1] === 'b' ||
        template[i + 1] === 'r' ||
        template[i + 1] === 's') &&
      template[i + 2] === ':'
    ) {
      const type = template[i + 1] as 'f' | 'b' | 'r' | 's';
      let depth = 1;
      let j = i + 1;
      while (j < template.length && depth > 0) {
        j++;
        if (template[j] === '{') { depth++; }
        else if (template[j] === '}') { depth--; }
      }
      if (depth === 0) {
        const full = template.substring(i, j + 1);
        const args = template.substring(i + 3, j);
        tokens.push({ full, type, args, index: i });
        i = j + 1;
        continue;
      }
    }
    i++;
  }
  return tokens;
}

// ─── Exported helpers (also used in unit tests) ───────────────────────────────

export function isSafeWorkspacePath(workspaceRoot: string, candidate: string): boolean {
  if (path.isAbsolute(candidate)) {
    return false;
  }
  if (candidate.includes('..')) {
    return false;
  }
  const resolved = path.resolve(workspaceRoot, candidate);
  return resolved === workspaceRoot || resolved.startsWith(workspaceRoot + path.sep);
}

export function readJsonDotPath(jsonText: string, dotPath: string): string | undefined {
  let obj: unknown;
  try {
    obj = JSON.parse(jsonText);
  } catch {
    return undefined;
  }

  const parts = dotPath.split('.').filter((p) => p.length > 0);
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  if (current === undefined || current === null) {
    return undefined;
  }
  return String(current);
}

export function extractFirstRegexMatch(
  branch: string,
  regexSrc: string,
  logger: TagTemplateLogger
): string {
  let re: RegExp;
  try {
    re = new RegExp(regexSrc, 'g');
  } catch {
    logger.warn(`[Create Tag] Invalid branch regex: ${regexSrc}`);
    return '';
  }

  const matches = [...branch.matchAll(re)].map((m) => m[0]);
  logger.info(`[Create Tag] Regex matches: ${matches.join(', ') || '(none)'}`);

  if (matches.length === 0) {
    return '';
  }

  logger.info(`[Create Tag] Selected branch match: ${matches[0]}`);
  return matches[0];
}

// ─── Default script runner ────────────────────────────────────────────────────

function defaultRunScript(absScriptPath: string, cwd: string): Promise<ScriptRunResult> {
  return new Promise((resolve) => {
    const proc = spawn(absScriptPath, [], { cwd, shell: false });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 1 });
    });
    proc.on('error', (e) => {
      resolve({ stdout: '', stderr: e.message, exitCode: 1 });
    });
  });
}

// ─── File token resolution ────────────────────────────────────────────────────

async function resolveFileToken(
  filePath: string,
  jsonPath: string,
  ctx: TagTemplateContext
): Promise<string> {
  if (!isSafeWorkspacePath(ctx.workspaceRoot, filePath)) {
    ctx.logger.warn(`[Create Tag] Unsafe file path in template token: ${filePath}`);
    return '';
  }

  const absPath = path.resolve(ctx.workspaceRoot, filePath);
  const realpathFn = ctx.realpath ?? ((p: string) => fs.realpath(p));

  let realAbs: string;
  try {
    realAbs = await realpathFn(absPath);
  } catch {
    ctx.logger.warn(`[Create Tag] File not found: ${filePath}`);
    return '';
  }

  if (realAbs !== ctx.workspaceRoot && !realAbs.startsWith(ctx.workspaceRoot + path.sep)) {
    ctx.logger.warn(`[Create Tag] Unsafe file path in template token: ${filePath}`);
    return '';
  }

  ctx.logger.info(`[Create Tag] File token found: ${filePath}, path: ${jsonPath}`);

  const reader = ctx.readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  let content: string;
  try {
    content = await reader(absPath);
  } catch {
    ctx.logger.warn(`[Create Tag] Could not read file: ${filePath}`);
    return '';
  }

  const value = readJsonDotPath(content, jsonPath);
  if (value === undefined) {
    const isInvalidJson = readJsonDotPath(content, '.') === undefined && (() => {
      try { JSON.parse(content); return false; } catch { return true; }
    })();
    if (isInvalidJson) {
      ctx.logger.warn(`[Create Tag] Could not parse JSON file: ${filePath}`);
    } else {
      ctx.logger.warn(`[Create Tag] JSON path "${jsonPath}" was not found in ${filePath}.`);
    }
    return '';
  }

  ctx.logger.info(`[Create Tag] File token resolved: ${value}`);
  return value;
}

// ─── Script token resolution ──────────────────────────────────────────────────

async function resolveScriptToken(
  stream: string,
  scriptPath: string,
  ctx: TagTemplateContext
): Promise<string> {
  if (!isSafeWorkspacePath(ctx.workspaceRoot, scriptPath)) {
    throw new ScriptTokenError(
      `[Create Tag] Unsafe script path in template token: ${scriptPath}`,
      scriptPath
    );
  }

  const absPath = path.resolve(ctx.workspaceRoot, scriptPath);
  const realpathFn = ctx.realpath ?? ((p: string) => fs.realpath(p));

  let realAbs: string;
  try {
    realAbs = await realpathFn(absPath);
  } catch {
    throw new ScriptTokenError(
      `[Create Tag] Script not found: ${scriptPath}`,
      scriptPath
    );
  }

  if (realAbs !== ctx.workspaceRoot && !realAbs.startsWith(ctx.workspaceRoot + path.sep)) {
    throw new ScriptTokenError(
      `[Create Tag] Unsafe script path in template token: ${scriptPath}`,
      scriptPath
    );
  }

  ctx.logger.info(`[Create Tag] Script token found: ${scriptPath}, stream: ${stream}`);

  const runner = ctx.runScript ?? defaultRunScript;
  let result: ScriptRunResult;
  try {
    result = await runner(realAbs, ctx.workspaceRoot);
  } catch (e) {
    throw new ScriptTokenError(
      `[Create Tag] Failed to run script "${scriptPath}": ${e}`,
      scriptPath
    );
  }

  ctx.logger.info(
    `[Create Tag] Script "${scriptPath}" exited with code ${result.exitCode}`
  );

  if (result.exitCode !== 0) {
    throw new ScriptTokenError(
      `Script "${scriptPath}" exited with code ${result.exitCode}`,
      scriptPath,
      result.exitCode,
      result.stderr
    );
  }

  const output = stream === 'stderr' ? result.stderr : result.stdout;
  ctx.logger.info(`[Create Tag] Script token resolved: ${output}`);
  return output;
}

// ─── Main resolver ────────────────────────────────────────────────────────────

export async function resolveTagTemplate(
  template: string,
  ctx: TagTemplateContext
): Promise<ResolvedTag> {
  ctx.logger.info(`[Create Tag] Template: ${template}`);

  const tokens = scanTokens(template);

  // Step 1: resolve {f:...} tokens
  let result = template;
  for (const token of tokens.filter((t) => t.type === 'f')) {
    const colonIdx = token.args.indexOf(':');
    if (colonIdx === -1) {
      ctx.logger.warn(`[Create Tag] Malformed file token: ${token.full}`);
      result = result.replace(token.full, '');
      continue;
    }
    const filePath = token.args.substring(0, colonIdx).trim();
    const jsonPath = token.args.substring(colonIdx + 1).trim();
    const value = await resolveFileToken(filePath, jsonPath, ctx);
    result = result.replace(token.full, value);
  }

  // Step 2: resolve {s:...} tokens (throws ScriptTokenError on failure)
  for (const token of tokens.filter((t) => t.type === 's')) {
    const colonIdx = token.args.indexOf(':');
    // {s:./script.sh} → stream defaults to stdout; {s:stdout:./script.sh} is explicit
    const stream = colonIdx === -1 ? 'stdout' : token.args.substring(0, colonIdx).trim().toLowerCase();
    const scriptPath = colonIdx === -1 ? token.args.trim() : token.args.substring(colonIdx + 1).trim();
    const value = await resolveScriptToken(stream, scriptPath, ctx);
    result = result.replace(token.full, value);
  }

  // Step 3: resolve {b:...} tokens
  const branchTokens = tokens.filter((t) => t.type === 'b');
  if (branchTokens.length > 0) {
    let branch = '';
    try {
      branch = await ctx.getCurrentBranch();
    } catch {
      branch = '';
    }
    if (!branch) {
      ctx.logger.info(
        '[Create Tag] Cannot resolve branch token because Git is in detached HEAD state.'
      );
    } else {
      ctx.logger.info(`[Create Tag] Current branch: ${branch}`);
    }

    for (const token of branchTokens) {
      let value = '';
      if (branch) {
        ctx.logger.info(`[Create Tag] Branch regex token found: ${token.args}`);
        value = extractFirstRegexMatch(branch, token.args, ctx.logger);
      }
      result = result.replace(token.full, value);
    }
  }

  // Step 4: resolve {r:N} token last (recurring/auto-increment)
  const recurringTokens = tokens.filter((t) => t.type === 'r');
  if (recurringTokens.length === 0) {
    return { tag: result, recurringAttempts: 0 };
  }

  const startN = parseInt(recurringTokens[0].args, 10);
  let currentN = isNaN(startN) ? 1 : startN;
  let attempts = 0;

  while (attempts < MAX_RECURRING_ITERATIONS) {
    let candidate = result;
    for (const token of recurringTokens) {
      candidate = candidate.replace(token.full, String(currentN));
    }
    attempts++;

    const exists = await ctx.tagExists(candidate);
    ctx.logger.info(
      `[Create Tag] Trying tag: ${candidate} — ${exists ? 'exists' : 'available'}`
    );

    if (!exists) {
      return { tag: candidate, recurringValueUsed: currentN, recurringAttempts: attempts };
    }
    currentN++;
  }

  throw new Error(
    `[Create Tag] Could not find available tag after ${MAX_RECURRING_ITERATIONS} attempts.`
  );
}
