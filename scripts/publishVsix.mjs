#!/usr/bin/env node
// Publishes one packaged VSIX to both the VS Code Marketplace and Open VSX,
// independently, with retry. Replaces the old `vsce publish && ovsx publish`
// chain in release.config.js, which let a transient failure on one registry
// (e.g. a Marketplace gallery timeout) silently prevent the other from ever
// being attempted -- see plans/2026-08-09-pre-release-publish-failure-postmortem.md.
//
// Design:
//  - The two registries are published via Promise.allSettled so a failure in
//    one never blocks or cancels the other.
//  - Transient failures (gallery timeouts, connection resets, 5xx) are retried
//    with exponential backoff.
//  - "Already published" is treated as SUCCESS, which is what makes this
//    script safe to re-run against a tag that partially published --
//    the core requirement for the Republish recovery workflow.

import { spawn } from 'node:child_process';

const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 1000;
const BACKOFF_FACTOR = 4; // 1s, 4s, 16s

const TRANSIENT_ERROR_PATTERN =
  /request timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|network error|\b50[0234]\b/i;
const ALREADY_PUBLISHED_PATTERN =
  /already (been )?(published|exists)|is already published|version .* already exists/i;

/** @param {string} output @returns {'already-published' | 'transient' | 'fatal'} */
export function classifyFailure(output) {
  if (ALREADY_PUBLISHED_PATTERN.test(output)) return 'already-published';
  if (TRANSIENT_ERROR_PATTERN.test(output)) return 'transient';
  return 'fatal';
}

/** @param {number} attempt 1-based attempt number that just failed */
export function backoffDelayMs(attempt) {
  return BASE_DELAY_MS * BACKOFF_FACTOR ** (attempt - 1);
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `run()` up to `attempts` times, retrying on transient failures and
 * treating "already published" as a terminal success.
 *
 * @param {{ label: string, run: () => Promise<{ ok: boolean, output: string }>, attempts?: number, sleep?: (ms: number) => Promise<void> }} opts
 */
export async function publishToRegistry({ label, run, attempts = MAX_ATTEMPTS, sleep = defaultSleep }) {
  let lastOutput = '';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await run();
    if (result.ok) {
      return { label, status: 'published', attempt };
    }

    lastOutput = result.output;
    const kind = classifyFailure(result.output);

    if (kind === 'already-published') {
      return { label, status: 'already-published', attempt };
    }
    if (kind === 'fatal' || attempt === attempts) {
      return { label, status: 'failed', attempt, output: lastOutput };
    }

    await sleep(backoffDelayMs(attempt));
  }
  return { label, status: 'failed', attempt: attempts, output: lastOutput };
}

function spawnCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
      process.stderr.write(chunk);
    });
    child.on('close', (code) => resolve({ ok: code === 0, output }));
    child.on('error', (err) => resolve({ ok: false, output: `${output}\n${err.message}` }));
  });
}

async function main() {
  const args = process.argv.slice(2);
  const preRelease = args.includes('--pre-release');
  const vsixPath = args.find((a) => !a.startsWith('--'));

  if (!vsixPath) {
    console.error('Usage: node scripts/publishVsix.mjs <path-to-vsix> [--pre-release]');
    process.exit(1);
  }

  const vscodePat = process.env.VSCODE_PAT;
  const openVsxPat = process.env.OPEN_VSX_PAT;
  if (!vscodePat || !openVsxPat) {
    console.error('Both VSCODE_PAT and OPEN_VSX_PAT must be set in the environment.');
    process.exit(1);
  }

  const vsceArgs = [
    'vsce',
    'publish',
    '--pat',
    vscodePat,
    '--packagePath',
    vsixPath,
    ...(preRelease ? ['--pre-release'] : []),
  ];
  // ovsx ignores/warns on --pre-release for a prepackaged VSIX -- the
  // Microsoft.VisualStudio.Code.PreRelease marker baked in by `vsce package
  // --pre-release` is what Open VSX actually reads, so the flag is omitted here.
  const ovsxArgs = ['ovsx', 'publish', '--pat', openVsxPat, '--packagePath', vsixPath];

  const settled = await Promise.allSettled([
    publishToRegistry({ label: 'VS Code Marketplace', run: () => spawnCommand('yarn', vsceArgs) }),
    publishToRegistry({ label: 'Open VSX', run: () => spawnCommand('yarn', ovsxArgs) }),
  ]);

  const labels = ['VS Code Marketplace', 'Open VSX'];
  const results = settled.map((r, i) =>
    r.status === 'fulfilled' ? r.value : { label: labels[i], status: 'failed', output: String(r.reason) },
  );

  console.log('\n=== Publish summary ===');
  for (const r of results) {
    const attemptNote = r.attempt ? ` (attempt ${r.attempt}/${MAX_ATTEMPTS})` : '';
    console.log(`  ${r.label}: ${r.status}${attemptNote}`);
  }

  const failed = results.filter((r) => r.status === 'failed');
  if (failed.length > 0) {
    for (const r of failed) {
      console.error(`\n::error::${r.label} publish failed after ${r.attempt} attempt(s).`);
      if (r.output) console.error(r.output);
    }
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
