import styles from './Hero.module.css';

const MARKETPLACE_URL = 'https://marketplace.visualstudio.com/items?itemName=vradchuk.git-smart-checkout';
const OPEN_VSX_URL = 'https://open-vsx.org/extension/vradchuk/git-smart-checkout';
const GITHUB_URL = 'https://github.com/zaknafeyn/git-smart-checkout';

const EDITORS = [
  { name: 'VS Code',  url: 'https://code.visualstudio.com/', icon: <img src="/icons/vscode.png"  width={14} height={14} alt="" /> },
  { name: 'Cursor',   url: 'https://cursor.com/',            icon: <img src="/icons/cursor.png"  width={14} height={14} alt="" /> },
  { name: 'Windsurf', url: 'https://windsurf.com/',          icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="#00C6AE" aria-hidden="true"><path d="M2 13C4.5 7 7.5 7 10 13C12.5 19 15.5 19 18 13C19.5 10 21.5 10 22 13L22 18L2 18Z"/></svg> },
  { name: 'VSCodium', url: 'https://vscodium.com/',          icon: null },
];

export function Hero() {
  return (
    <section className={styles.hero}>
      <div className={`container ${styles.inner}`}>
        <div className={styles.badge}>
          <span className={styles.badgeDot} />
          Free & Open Source
        </div>

        <h1 className={styles.title}>
          Git checkout,{' '}
          <span className={styles.titleAccent}>finally smart</span>
        </h1>

        <p className={styles.subtitle}>
          Stop losing uncommitted work when switching branches.
          Git Smart Checkout automatically stashes your changes, switches branches,
          and restores your work — all in one command.
        </p>

        <div className={styles.actions}>
          <a href={MARKETPLACE_URL} className={styles.btnPrimary} target="_blank" rel="noreferrer">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 19.88V4.12a1.5 1.5 0 0 0-.85-1.533zM16.61 17.01L9.77 12l6.84-5.01v10.02z"/>
            </svg>
            Install on VS Code
          </a>
          <a href={OPEN_VSX_URL} className={styles.btnSecondary} target="_blank" rel="noreferrer">
            <svg width="18" height="18" viewBox="0 0 106 132" aria-hidden="true">
              <path d="M30 44.2L52.6 5H7.3zM4.6 88.5h45.3L27.2 49.4zm51 0l22.6 39.2 22.6-39.2z" fill="#c160ef"/>
              <path d="M52.6 5L30 44.2h45.2zM27.2 49.4l22.7 39.1 22.6-39.1zm51 0L55.6 88.5h45.2z" fill="#a60ee5"/>
            </svg>
            Open VSX
          </a>
          <a href={GITHUB_URL} className={styles.btnGhost} target="_blank" rel="noreferrer">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
            </svg>
            View on GitHub
          </a>
        </div>

        <div className={styles.compatRow}>
          <span className={styles.compatLabel}>Works with</span>
          <div className={styles.compatEditors}>
            {EDITORS.map(({ name, url, icon }) => (
              <a key={name} href={url} className={styles.editor} target="_blank" rel="noreferrer">
                {icon}
                {name}
              </a>
            ))}
          </div>
        </div>

        <div className={styles.codeBlock}>
          <span className={styles.codePrompt}>⌘ ⇧ P</span>
          <span className={styles.codeCmd}>Git: Checkout to... (With Stash)</span>
          <span className={styles.codeCursor} aria-hidden="true">▋</span>
        </div>
      </div>

      <div className={styles.glow} aria-hidden="true" />
    </section>
  );
}
