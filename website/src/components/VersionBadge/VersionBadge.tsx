import { useEffect, useState } from 'react';

import styles from './VersionBadge.module.css';

const EXTENSION_ID = 'vradchuk.git-smart-checkout';
const [PUBLISHER, EXT_NAME] = EXTENSION_ID.split('.');

const MARKETPLACE_URL = `https://marketplace.visualstudio.com/items?itemName=${EXTENSION_ID}`;

// This repo publishes on an odd/even minor convention: stable = major.EVEN.patch,
// pre-release = major.ODD.patch (see docs/releasing.md). The website badge should
// only ever advertise the latest stable version.
function isEvenMinor(version: string): boolean {
  const minor = Number(version.split('.')[1]);
  return Number.isFinite(minor) && minor % 2 === 0;
}

interface GalleryVersion {
  version?: string;
  properties?: Array<{ key: string; value: string }>;
}

async function fetchMsVersion(): Promise<string> {
  const response = await fetch('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json;api-version=3.0-preview.1',
    },
    body: JSON.stringify({
      filters: [{ criteria: [{ filterType: 7, value: EXTENSION_ID }] }],
      // Same flags as before minus IncludeLatestVersionOnly (0x200 / 512), so the
      // full version history comes back (each with `properties`) instead of only
      // the newest publish -- needed to skip past pre-release versions below.
      flags: 438,
    }),
  });
  if (!response.ok) throw new Error(`MS API ${response.status}`);
  const data = await response.json();
  const versions: GalleryVersion[] = data.results[0].extensions[0].versions ?? [];
  const stable = versions.find((v) => {
    if (!v.version) return false;
    const isPreRelease = v.properties?.some(
      (p) => p.key === 'Microsoft.VisualStudio.Code.PreRelease' && p.value === 'true'
    );
    return !isPreRelease && isEvenMinor(v.version);
  });
  if (!stable?.version) throw new Error('MS API: no stable version');
  return stable.version;
}

async function fetchOvsxVersion(): Promise<string> {
  const response = await fetch(`https://open-vsx.org/api/${PUBLISHER}/${EXT_NAME}`);
  if (!response.ok) throw new Error(`Open VSX API ${response.status}`);
  const data = await response.json();
  if (!data || data.error || !data.version) throw new Error('Open VSX API: no version');
  if (data.preRelease !== true) return data.version;

  // The latest published version is a pre-release: fall back to the newest
  // stable (even-minor) entry in the version list rather than fetching every
  // version's metadata just to read its `preRelease` flag.
  const allVersions: Record<string, string> = data.allVersions ?? {};
  const stable = Object.keys(allVersions)
    .filter((v) => v !== 'latest' && isEvenMinor(v))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
  if (!stable) throw new Error('Open VSX API: no stable version');
  return stable;
}

export function VersionBadge() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchMsVersion()
      .catch(() => fetchOvsxVersion())
      .then((v) => {
        if (!cancelled) setVersion(v);
      })
      .catch(() => {
        // Both sources failed — render nothing rather than a broken value.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!version) return null;

  return (
    <a
      href={MARKETPLACE_URL}
      className={styles.badge}
      target="_blank"
      rel="noreferrer"
      title="Latest published version on the VS Code Marketplace"
    >
      v{version}
    </a>
  );
}
