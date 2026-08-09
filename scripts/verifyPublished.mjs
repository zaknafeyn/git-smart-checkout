#!/usr/bin/env node
// Confirms a version actually landed on both the VS Code Marketplace and Open
// VSX after a release. Without this, a green semantic-release run was the
// only signal a release actually happened -- and that signal can lie (see
// plans/2026-08-09-pre-release-publish-failure-postmortem.md: a stale re-run
// exited 0 having published nothing).

const PUBLISHER = 'vradchuk';
const EXTENSION = 'git-smart-checkout';
const MARKETPLACE_URL = 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery';
const OPEN_VSX_URL = `https://open-vsx.org/api/${PUBLISHER}/${EXTENSION}`;
const PRE_RELEASE_PROPERTY = 'Microsoft.VisualStudio.Code.PreRelease';

export async function fetchMarketplaceVersions(fetchImpl = fetch) {
  const res = await fetchImpl(MARKETPLACE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json;api-version=7.2-preview.1',
    },
    body: JSON.stringify({
      filters: [{ criteria: [{ filterType: 7, value: `${PUBLISHER}.${EXTENSION}` }] }],
      // 2151 includes per-version `properties`, needed to read the PreRelease marker.
      flags: 2151,
    }),
  });
  if (!res.ok) throw new Error(`Marketplace query failed: HTTP ${res.status}`);
  const data = await res.json();
  return data?.results?.[0]?.extensions?.[0]?.versions ?? [];
}

export async function fetchOpenVsxVersions(fetchImpl = fetch) {
  const res = await fetchImpl(OPEN_VSX_URL);
  if (!res.ok) throw new Error(`Open VSX query failed: HTTP ${res.status}`);
  const data = await res.json();
  return Object.keys(data?.allVersions ?? {}).filter((v) => v !== 'latest');
}

/**
 * @param {Array<{ version: string, properties?: Array<{ key: string, value: string }> }>} versions
 * @param {string} version
 * @param {boolean} expectPreRelease
 */
export function marketplaceHasVersion(versions, version, expectPreRelease) {
  const match = versions.find((v) => v.version === version);
  if (!match) return false;
  if (!expectPreRelease) return true;

  const properties = match.properties ?? [];
  return properties.some((p) => p.key === PRE_RELEASE_PROPERTY && p.value === 'true');
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `check()` until it returns true or attempts are exhausted. */
export async function pollUntil(check, { attempts = 6, delayMs = 20000, sleep = defaultSleep } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await check()) return true;
    if (attempt < attempts) await sleep(delayMs);
  }
  return false;
}

async function main() {
  const args = process.argv.slice(2);
  const preRelease = args.includes('--pre-release');
  const version = args.find((a) => !a.startsWith('--'));

  if (!version) {
    console.error('Usage: node scripts/verifyPublished.mjs <version> [--pre-release]');
    process.exit(1);
  }

  console.log(`Verifying ${EXTENSION}@${version} (pre-release: ${preRelease}) is live on both registries...`);

  const marketplaceOk = await pollUntil(async () => {
    const versions = await fetchMarketplaceVersions();
    return marketplaceHasVersion(versions, version, preRelease);
  });
  console.log(`  VS Code Marketplace: ${marketplaceOk ? 'OK' : 'MISSING'}`);

  const openVsxOk = await pollUntil(async () => {
    const versions = await fetchOpenVsxVersions();
    return versions.includes(version);
  });
  console.log(`  Open VSX: ${openVsxOk ? 'OK' : 'MISSING'}`);

  if (!marketplaceOk || !openVsxOk) {
    const missing = [!marketplaceOk && 'the VS Code Marketplace', !openVsxOk && 'Open VSX'].filter(Boolean).join(' and ');
    console.error(
      `::error::${EXTENSION}@${version} is missing from ${missing} after polling. The release did not actually publish everywhere it should have -- see the Republish workflow to resume it.`,
    );
    process.exit(1);
  }

  console.log('Both registries confirmed.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
