import { useEffect, useRef, useState } from 'react';

import styles from './DownloadStats.module.css';

const EXTENSION_ID = 'vradchuk.git-smart-checkout';
const [PUBLISHER, EXT_NAME] = EXTENSION_ID.split('.');

const ANIMATION_DURATION = 2000;

function easeOutQuart(t: number): number {
  return 1 - Math.pow(1 - t, 4);
}

async function fetchMsInstalls(): Promise<number> {
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
  const stats: { statisticName: string; value: number }[] =
    data.results[0].extensions[0].statistics;
  return stats.find(s => s.statisticName === 'install')?.value ?? 0;
}

async function fetchOvsxInstalls(): Promise<number> {
  const response = await fetch(`https://open-vsx.org/api/${PUBLISHER}/${EXT_NAME}`);
  if (!response.ok) throw new Error(`Open VSX API ${response.status}`);
  const data = await response.json();
  if (!data || data.error) return 0;
  return data.downloadCount ?? 0;
}

export function DownloadStats() {
  const [total, setTotal] = useState<number | null>(null);
  const [displayCount, setDisplayCount] = useState(0);
  const [ready, setReady] = useState(false);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const timeoutId = setTimeout(() => setReady(true), 1500);

    Promise.allSettled([fetchMsInstalls(), fetchOvsxInstalls()]).then(
      ([msResult, ovsxResult]) => {
        const bothFailed = msResult.status === 'rejected' && ovsxResult.status === 'rejected';
        if (bothFailed) {
          setTotal(null);
        } else {
          const ms = msResult.status === 'fulfilled' ? msResult.value : 0;
          const ovsx = ovsxResult.status === 'fulfilled' ? ovsxResult.value : 0;
          setTotal(ms + ovsx);
        }
        clearTimeout(timeoutId);
        setReady(true);
      }
    );

    return () => clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (!ready || total === null) return;

    const start = performance.now();

    function tick(now: number) {
      const t = Math.min((now - start) / ANIMATION_DURATION, 1);
      setDisplayCount(Math.round(easeOutQuart(t) * total!));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [ready, total]);

  const countLabel = total === null ? '1000+' : displayCount.toLocaleString();

  return (
    <div className={styles.card}>
      <div className={styles.totalWrap}>
        <span className={styles.totalNum}>{countLabel}</span>
        <span className={styles.totalLabel}>Total Downloads</span>
      </div>
    </div>
  );
}
