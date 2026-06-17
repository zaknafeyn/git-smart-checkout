import { useEffect, useState } from 'react';

import styles from './VersionBadge.module.css';

const EXTENSION_ID = 'vradchuk.git-smart-checkout';
const [PUBLISHER, EXT_NAME] = EXTENSION_ID.split('.');

const MARKETPLACE_URL = `https://marketplace.visualstudio.com/items?itemName=${EXTENSION_ID}`;

async function fetchMsVersion(): Promise<string> {
  const response = await fetch('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json;api-version=3.0-preview.1',
    },
    body: JSON.stringify({
      filters: [{ criteria: [{ filterType: 7, value: EXTENSION_ID }] }],
      flags: 950,
    }),
  });
  if (!response.ok) throw new Error(`MS API ${response.status}`);
  const data = await response.json();
  const version: string | undefined = data.results[0].extensions[0].versions[0].version;
  if (!version) throw new Error('MS API: no version');
  return version;
}

async function fetchOvsxVersion(): Promise<string> {
  const response = await fetch(`https://open-vsx.org/api/${PUBLISHER}/${EXT_NAME}`);
  if (!response.ok) throw new Error(`Open VSX API ${response.status}`);
  const data = await response.json();
  if (!data || data.error || !data.version) throw new Error('Open VSX API: no version');
  return data.version;
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
