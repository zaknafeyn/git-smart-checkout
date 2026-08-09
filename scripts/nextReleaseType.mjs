#!/usr/bin/env node
// Deterministic release-type resolver for the odd/even minor pre-release convention
// (stable = major.EVEN.patch, pre-release = major.ODD.patch). Used as the
// analyzeCommitsCmd for @semantic-release/exec in release.config.js.

/**
 * @param {'pre' | 'stable'} channel
 * @param {string | undefined} lastVersion e.g. "0.16.1"
 * @returns {'major' | 'minor' | 'patch' | ''}
 */
export function releaseType(channel, lastVersion) {
  const minor = lastVersion ? Number(lastVersion.split('.')[1]) : undefined;
  const isOddMinor = minor !== undefined && minor % 2 !== 0;

  if (channel === 'pre') {
    return isOddMinor ? 'patch' : 'minor';
  }

  // stable: jump over the pre-release corridor when the last release was odd;
  // otherwise defer to @semantic-release/commit-analyzer (no opinion).
  return isOddMinor ? 'minor' : '';
}

async function main() {
  const [channel, lastVersion] = process.argv.slice(2);
  process.stdout.write(releaseType(channel, lastVersion || undefined));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
